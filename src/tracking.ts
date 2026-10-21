/**
 * 摄像头与识别线程之间的桥接模块。
 * 主线程取帧 → Worker推理 → result回调交给main.ts处理琴键交互。
 */
import type { Hand } from "./core";
export interface TrackingResult {
  hands: Hand[];
  timestamp: number; // 主线程取帧时的时间戳，用来识别迟到结果。
  ms: number; // Worker处理这一帧的耗时，不是动作到出声的总延迟。
}
export class CameraTracker {
  private worker?: Worker;
  private stream?: MediaStream;
  // 同时最多一个取帧/推理任务；繁忙时跳过新帧，不堆积旧画面。
  private pending = false;
  private pendingAt = 0;
  private lastVideoTime = -1;
  private lastCapture = 0;
  // stop时递增，使仍在等待授权的旧openCamera任务失效。
  private generation = 0;
  private rejectInit?: (reason: Error) => void;
  delegate = "";
  constructor(
    private video: HTMLVideoElement,
    private result: (r: TrackingResult) => void,
    private error: (e: Error) => void,
  ) {}
  /** 请求摄像头并接到video元素；只请求视频，不使用麦克风。 */
  async openCamera() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
      throw new Error("请使用 localhost 或 HTTPS 地址访问，才能开启摄像头。");
    const generation = this.generation;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: "user",
      },
      audio: false,
    });
    // 用户可能在授权弹窗返回前点了结束；迟到的视频流也必须关闭。
    if (generation !== this.generation) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error("启动已取消");
    }
    this.stream = stream;
    stream.getVideoTracks()[0].addEventListener("ended", () => {
      if (this.stream === stream)
        this.error(new Error("摄像头已断开，请结束后重新启动。"));
    });
    this.video.srcObject = stream;
    await this.video.play();
  }
  /**
   * 创建经典Worker并等待ready消息。Promise把消息回调转成可await的初始化操作。
   * 初始化失败会reject；初始化成功后的推理错误则通过error回调通知主程序。
   */
  initModel() {
    return new Promise<void>((resolve, reject) => {
      const worker = new Worker(`${import.meta.env.BASE_URL}tracker.worker.js`);
      this.worker = worker;
      const timeout = window.setTimeout(
        () =>
          fail(new Error("模型初始化超时，请重试并检查浏览器是否支持 WebGL。")),
        45000,
      );
      const fail = (e: Error) => {
        clearTimeout(timeout);
        this.rejectInit = undefined;
        reject(e);
      };
      this.rejectInit = fail;
      let ready = false;
      worker.onmessage = ({ data }) => {
        // 重启后旧Worker的消息即使迟到，也不能影响当前会话。
        if (worker !== this.worker) return;
        if (data.type === "ready") {
          clearTimeout(timeout);
          this.rejectInit = undefined;
          this.delegate = data.delegate;
          ready = true;
          resolve();
        }
        if (data.type === "error") {
          this.pending = false;
          if (ready) this.error(new Error(data.message));
          else fail(new Error(data.message));
        }
        if (data.type === "result") {
          this.pending = false;
          this.result(data);
        }
      };
      worker.onerror = (event) => {
        const e = new Error(
          `识别线程错误：${event.message || "请检查本地模型资源"}`,
        );
        if (ready) this.error(e);
        else fail(e);
      };
      worker.postMessage({ type: "init" });
    });
  }
  /** 由绘画循环尝试调用；now来自requestAnimationFrame的毫秒时间戳。 */
  capture(now: number) {
    if (this.pending && now - this.pendingAt > 5000) {
      this.pending = false;
      this.error(new Error("识别超时，请结束后重新启动。"));
      return;
    }
    // 依次跳过：仍繁忙、线程未创建、视频未就绪、重复帧、距离上次取帧不足30毫秒。
    if (
      this.pending ||
      !this.worker ||
      this.video.readyState < 2 ||
      this.video.currentTime === this.lastVideoTime ||
      now - this.lastCapture < 30
    )
      return;
    this.pending = true;
    this.pendingAt = now;
    this.lastCapture = now;
    this.lastVideoTime = this.video.currentTime;
    const worker = this.worker;
    // 将当前视频画面转换成可传递的图片，按原比例缩放到640宽。
    createImageBitmap(this.video, {
      resizeWidth: 640,
      resizeHeight: Math.round(
        (640 * this.video.videoHeight) / this.video.videoWidth,
      ),
    })
      .then((bitmap) => {
        // 取图本身也是异步的；等待期间若已结束或重启，就直接释放这张图片。
        if (this.worker !== worker) {
          bitmap.close();
          return;
        }
        // 最后的[bitmap]转移图片控制权，避免复制大块数据；接收方负责close。
        worker.postMessage({ type: "frame", bitmap, timestamp: now }, [bitmap]);
      })
      .catch((e) => {
        if (this.worker === worker) {
          this.pending = false;
          this.error(new Error(`视频帧读取失败：${e.message}`));
        }
      });
  }
  /** 终止识别、停止摄像头轨道并解除video连接；仅隐藏video并不能关闭设备。 */
  stop() {
    this.generation++;
    this.rejectInit?.(new Error("启动已取消"));
    this.rejectInit = undefined;
    this.worker?.terminate();
    this.worker = undefined;
    this.pending = false;
    this.lastVideoTime = -1;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    this.video.pause();
    this.video.srcObject = null;
  }
}
/** 将常见浏览器错误转换成用户能采取行动的中文提示。 */
export function cameraError(e: unknown): string {
  if (e instanceof DOMException) {
    if (e.name === "NotAllowedError")
      return "摄像头权限被拒绝。请在地址栏的网站权限中允许摄像头，然后重试。";
    if (e.name === "NotFoundError")
      return "未找到摄像头。请连接设备后重试，也可以先使用鼠标试听。";
    if (e.name === "NotReadableError")
      return "无法读取摄像头。请检查设备是否被其他应用占用。";
  }
  return e instanceof Error ? e.message : "启动失败，请重试。";
}
