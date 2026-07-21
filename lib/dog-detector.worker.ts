import { FilesetResolver, ObjectDetector } from "@mediapipe/tasks-vision";

type WorkerRequest =
  | { type: "init" }
  | { type: "frame"; id: number; bitmap: ImageBitmap };

const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-tasks/object_detector/efficientdet_lite0_uint8.tflite";

let detector: ObjectDetector | null = null;

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === "init") {
    try {
      const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
      detector = await ObjectDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
        runningMode: "IMAGE",
        categoryAllowlist: ["dog"],
        maxResults: 2,
        scoreThreshold: 0.35,
      });
      self.postMessage({ type: "ready" });
    } catch (cause) {
      self.postMessage({
        type: "error",
        message: cause instanceof Error ? cause.message : "Dog detector could not load",
      });
    }
    return;
  }

  if (!detector) {
    message.bitmap.close();
    self.postMessage({ type: "error", message: "Dog detector is not ready" });
    return;
  }

  const startedAt = performance.now();
  try {
    const result = detector.detect(message.bitmap);
    const candidate = result.detections
      .filter((detection) => detection.categories[0]?.categoryName === "dog")
      .sort((left, right) => (right.categories[0]?.score ?? 0) - (left.categories[0]?.score ?? 0))[0];
    const box = candidate?.boundingBox;
    self.postMessage({
      type: "result",
      id: message.id,
      visible: Boolean(candidate && box),
      confidence: candidate?.categories[0]?.score ?? 0,
      box: box
        ? {
            x: box.originX / message.bitmap.width,
            y: box.originY / message.bitmap.height,
            width: box.width / message.bitmap.width,
            height: box.height / message.bitmap.height,
          }
        : null,
      inferenceMs: performance.now() - startedAt,
    });
  } catch (cause) {
    self.postMessage({
      type: "error",
      message: cause instanceof Error ? cause.message : "Dog detection failed",
    });
  } finally {
    message.bitmap.close();
  }
};

