/**
 * Hand tracking worker: accepts init/frame messages and returns ready/result/error.
 * Use a classic worker because the current WASM loader requires importScripts.
 * The model runs locally. Frames are not uploaded; note rules and audio are handled elsewhere.
 */
// Provide exports for the CommonJS bundle before importing the local runtime.
self.exports = {};
let landmarker;
self.onmessage = async ({ data }) => {
  if (data.type === "init") {
    try {
      importScripts("assets/mediapipe/vision_bundle.js");
      const { FilesetResolver, HandLandmarker } = self.exports;
      // Use WASM files copied from the same package version as the JavaScript runtime.
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
        // Workers have no DOM; use an offscreen canvas for model image processing.
        canvas: new OffscreenCanvas(1, 1),
        runningMode: "VIDEO",
        numHands: 2,
        // Detection, presence, and tracking thresholds are not a claim of 55% accuracy.
        minHandDetectionConfidence: 0.55,
        minHandPresenceConfidence: 0.55,
        minTrackingConfidence: 0.55,
      });
      // Try GPU first, then CPU on initialization failure; report an error only if both fail.
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
        message: `Hand model initialization failed: ${error.message}`,
      });
    }
  }
  if (data.type === "frame") {
    const started = performance.now();
    try {
      if (!landmarker) throw new Error("Model not ready");
      // Inference is synchronous; run it in a worker to keep the UI responsive.
      const result = landmarker.detectForVideo(data.bitmap, data.timestamp);
      self.postMessage({
        type: "result",
        timestamp: data.timestamp,
        ms: performance.now() - started,
        // Return only the 21 landmarks and handedness needed by main-thread interaction rules.
        hands: result.landmarks.map((landmarks, i) => ({
          landmarks,
          label: result.handedness[i]?.[0]?.categoryName ?? "Unknown",
        })),
      });
    } catch (error) {
      self.postMessage({
        type: "error",
        message: `Hand tracking failed: ${error.message}`,
      });
    } finally {
      // Always close the image, on success or failure, to avoid accumulating frame memory.
      data.bitmap.close();
    }
  }
};
