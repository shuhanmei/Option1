/**
 * 手部识别工作线程：接收init或frame消息，返回ready、result或error。
 * 使用经典Worker，因为当前WASM加载器需要importScripts。
 * 模型在本机浏览器内运行，帧不上传；这里不处理琴键或播放声音。
 */
// 包内CommonJS代码会向exports写出接口，先提供它，再导入本地运行库。
self.exports = {};
let landmarker;
self.onmessage = async ({ data }) => {
  if (data.type === "init") {
    try {
      importScripts("assets/mediapipe/vision_bundle.js");
      const { FilesetResolver, HandLandmarker } = self.exports;
      // WASM是模型运行所需的本地执行文件，由与JS运行库相同版本的包复制而来。
      const files = await FilesetResolver.forVisionTasks(
        new URL("assets/mediapipe/wasm", self.location.href).href,
      );
      const options = (delegate) => ({
        baseOptions: {
          modelAssetPath: new URL(
            "assets/hand_landmarker.task",
            self.location.href,
          ).href,
          delegate,
        },
        // Worker不能操作页面DOM，使用离屏画布满足模型的图像处理需要。
        canvas: new OffscreenCanvas(1, 1),
        runningMode: "VIDEO",
        numHands: 2,
        // 检测、手部存在与跟踪各有接受阈值，这些值不代表“准确率55%”。
        minHandDetectionConfidence: 0.55,
        minHandPresenceConfidence: 0.55,
        minTrackingConfidence: 0.55,
      });
      // 优先尝试GPU，初始化失败时回退CPU；两者都失败才报告初始化错误。
      let delegate = "GPU";
      try {
        landmarker = await HandLandmarker.createFromOptions(
          files,
          options("GPU"),
        );
      } catch {
        delegate = "CPU";
        landmarker = await HandLandmarker.createFromOptions(
          files,
          options("CPU"),
        );
      }
      self.postMessage({ type: "ready", delegate });
    } catch (error) {
      self.postMessage({
        type: "error",
        message: `手部模型初始化失败：${error.message}`,
      });
    }
  }
  if (data.type === "frame") {
    const started = performance.now();
    try {
      if (!landmarker) throw new Error("模型未就绪");
      // 推理是同步计算，放在Worker中执行，减少对界面响应的影响。
      const result = landmarker.detectForVideo(data.bitmap, data.timestamp);
      self.postMessage({
        type: "result",
        timestamp: data.timestamp,
        ms: performance.now() - started,
        // 只返回交互需要的21个关键点和左右手标签，琴键规则由主线程处理。
        hands: result.landmarks.map((landmarks, i) => ({
          landmarks,
          label: result.handedness[i]?.[0]?.categoryName ?? "Unknown",
        })),
      });
    } catch (error) {
      self.postMessage({
        type: "error",
        message: `手部识别失败：${error.message}`,
      });
    } finally {
      // 无论识别成功或失败都释放图片；否则连续取帧会持续占用资源。
      data.bitmap.close();
    }
  }
};
