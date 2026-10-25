/**
 * Bridge between the camera and the inference worker.
 * Main thread captures frames -> worker infers landmarks -> main.ts processes fingertip interaction.
 */
import type { Hand } from "./core";
export interface TrackingResult {
  hands: Hand[];
  timestamp: number; // Main-thread capture timestamp, used to reject stale results.
  ms: number; // Inference duration for this frame, not total motion-to-sound latency.
}
export class CameraTracker {
  private worker?: Worker;
  private stream?: MediaStream;
  // Keep at most one capture/inference task in flight; skip new frames while busy.
  private pending = false;
  private pendingAt = 0;
  private lastVideoTime = -1;
  private lastCapture = 0;
  // Increment on stop to invalidate an older openCamera waiting for permission.
  private generation = 0;
  private rejectInit?: (reason: Error) => void;
  delegate = "";
  constructor(
    private video: HTMLVideoElement,
    private result: (r: TrackingResult) => void,
    private error: (e: Error) => void,
  ) {}
  /** Request video only, without microphone access, and connect it to the video element. */
  async openCamera() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
      throw new Error("Use localhost or HTTPS to enable the camera.");
    const generation = this.generation;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: "user",
      },
      audio: false,
    });
    // If the user ended while permission was pending, stop the late video stream too.
    if (generation !== this.generation) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error("Startup canceled");
    }
    this.stream = stream;
    stream.getVideoTracks()[0].addEventListener("ended", () => {
      if (this.stream === stream)
        this.error(
          new Error("Camera disconnected. End the session and restart."),
        );
    });
    this.video.srcObject = stream;
    await this.video.play();
  }
  /**
   * Create a classic worker and await its ready message through a Promise.
   * Reject initialization failures; report later inference errors through the error callback.
   */
  initModel() {
    return new Promise<void>((resolve, reject) => {
      const worker = new Worker(`${import.meta.env.BASE_URL}tracker.worker.js`);
      this.worker = worker;
      const timeout = window.setTimeout(
        () =>
          fail(
            new Error(
              "Model initialization timed out. Retry and check that your browser supports WebGL.",
            ),
          ),
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
        // Messages from an old worker must not affect a restarted session.
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
          `Tracking worker error: ${event.message || "Check the local model files"}`,
        );
        if (ready) this.error(e);
        else fail(e);
      };
      worker.postMessage({ type: "init" });
    });
  }
  /** Called by the drawing loop; now is the requestAnimationFrame timestamp in milliseconds. */
  capture(now: number) {
    if (this.pending && now - this.pendingAt > 5000) {
      this.pending = false;
      this.error(new Error("Tracking timed out. End the session and restart."));
      return;
    }
    // Skip busy, uninitialized, unready, duplicate, or less-than-30-ms-old frames.
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
    // Convert the current video frame to a transferable bitmap, preserving aspect ratio at width 640.
    createImageBitmap(this.video, {
      resizeWidth: 640,
      resizeHeight: Math.round(
        (640 * this.video.videoHeight) / this.video.videoWidth,
      ),
    })
      .then((bitmap) => {
        // Bitmap capture is asynchronous; close the image if the session ended or restarted meanwhile.
        if (this.worker !== worker) {
          bitmap.close();
          return;
        }
        // The transfer list moves bitmap ownership without copying; the receiver must close it.
        worker.postMessage({ type: "frame", bitmap, timestamp: now }, [bitmap]);
      })
      .catch((e) => {
        if (this.worker === worker) {
          this.pending = false;
          this.error(new Error(`Unable to read video frame: ${e.message}`));
        }
      });
  }
  /** Terminate inference, stop camera tracks, and disconnect video. Hiding video does not release hardware. */
  stop() {
    this.generation++;
    this.rejectInit?.(new Error("Startup canceled"));
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
/** Turn common browser errors into actionable English messages. */
export function cameraError(e: unknown): string {
  if (e instanceof DOMException) {
    if (e.name === "NotAllowedError")
      return "Camera permission denied. Allow the camera in the address bar site permissions, then retry.";
    if (e.name === "NotFoundError")
      return "No camera found. Connect one and retry, or use mouse playback.";
    if (e.name === "NotReadableError")
      return "Cannot access the camera. Check whether another app is using it.";
  }
  return e instanceof Error ? e.message : "Unable to start. Please retry.";
}
