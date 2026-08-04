import type { ObjectDetector as MediaPipeObjectDetector } from "@mediapipe/tasks-vision";

export type DogDetectorStatus = "loading" | "ready" | "unavailable";
export type PetKind = "dog" | "cat";

export interface DogBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DogReading {
  visible: boolean;
  confidence: number;
  box: DogBox | null;
  petKind: PetKind | null;
  targetMode: "auto" | "owner_guided";
  inferenceMs: number;
  observedAt: number;
}

export interface DogDetectorController {
  setMotionActive(active: boolean): void;
  setTargetBox(box: DogBox | null): void;
  retry(): void;
  stop(): void;
}

const SETTLED_INTERVAL_MS = 8_000;
const ACTIVE_INTERVAL_MS = 1_500;
const TRACKING_INTERVAL_MS = 700;
const TRACKING_GRACE_MS = 3_000;
const RETRY_INTERVAL_MS = 15_000;
const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-tasks/object_detector/efficientdet_lite0_uint8.tflite";

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function paddedBox(box: DogBox): DogBox {
  const padX = box.width * 0.045;
  const padY = box.height * 0.055;
  const x = clamp(box.x - padX);
  const y = clamp(box.y - padY);
  return {
    x,
    y,
    width: clamp(box.x + box.width + padX) - x,
    height: clamp(box.y + box.height + padY) - y,
  };
}

function smoothBox(previous: DogBox | null, next: DogBox): DogBox {
  if (!previous) return next;
  const previousCenterX = previous.x + previous.width / 2;
  const previousCenterY = previous.y + previous.height / 2;
  const nextCenterX = next.x + next.width / 2;
  const nextCenterY = next.y + next.height / 2;
  const centerShift = Math.hypot(nextCenterX - previousCenterX, nextCenterY - previousCenterY);
  const widthRatio = Math.max(next.width / Math.max(previous.width, 0.001), previous.width / Math.max(next.width, 0.001));
  const heightRatio = Math.max(next.height / Math.max(previous.height, 0.001), previous.height / Math.max(next.height, 0.001));
  const alpha = centerShift > 0.16 || widthRatio > 1.35 || heightRatio > 1.35 ? 0.78 : 0.48;
  return {
    x: previous.x + (next.x - previous.x) * alpha,
    y: previous.y + (next.y - previous.y) * alpha,
    width: previous.width + (next.width - previous.width) * alpha,
    height: previous.height + (next.height - previous.height) * alpha,
  };
}

function expandedSearchBox(box: DogBox): DogBox {
  const minimumWidth = 0.22;
  const minimumHeight = 0.22;
  const width = Math.min(1, Math.max(minimumWidth, box.width * 2.4));
  const height = Math.min(1, Math.max(minimumHeight, box.height * 2.4));
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const x = clamp(centerX - width / 2, 0, 1 - width);
  const y = clamp(centerY - height / 2, 0, 1 - height);
  return { x, y, width, height };
}

function boxCenterDistance(left: DogBox, right: DogBox) {
  return Math.hypot(
    left.x + left.width / 2 - (right.x + right.width / 2),
    left.y + left.height / 2 - (right.y + right.height / 2),
  );
}

export function startDogDetector(
  video: HTMLVideoElement,
  onReading: (reading: DogReading) => void,
  onStatus: (status: DogDetectorStatus) => void,
): DogDetectorController {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 216;
  const context = canvas.getContext("2d", { alpha: false });
  const targetCanvas = document.createElement("canvas");
  targetCanvas.width = 320;
  targetCanvas.height = 320;
  const targetContext = targetCanvas.getContext("2d", { alpha: false });
  let detector: MediaPipeObjectDetector | null = null;
  let timer: number | null = null;
  let retryTimer: number | null = null;
  let stopped = false;
  let ready = false;
  let initializing = false;
  let inFlight = false;
  let activeUntil = 0;
  let trackingUntil = 0;
  let lastBox: DogBox | null = null;
  let lastConfidence = 0;
  let consecutiveMisses = 0;
  let ownerGuided = false;
  let lastPetKind: PetKind | null = null;

  const schedule = (delay?: number) => {
    if (stopped) return;
    if (timer != null) window.clearTimeout(timer);
    const now = Date.now();
    const interval = now < trackingUntil ? TRACKING_INTERVAL_MS : now < activeUntil ? ACTIVE_INTERVAL_MS : SETTLED_INTERVAL_MS;
    timer = window.setTimeout(capture, delay ?? interval);
  };

  const capture = () => {
    if (stopped) return;
    if (!ready || inFlight || !context || !targetContext || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      schedule(1_000);
      return;
    }
    try {
      inFlight = true;
      const startedAt = performance.now();
      const targetAnchor = ownerGuided && consecutiveMisses < 3 ? lastBox : null;
      const searchBox = targetAnchor ? expandedSearchBox(targetAnchor) : null;
      const inferenceCanvas = searchBox ? targetCanvas : canvas;
      if (searchBox) {
        targetContext.drawImage(
          video,
          searchBox.x * video.videoWidth,
          searchBox.y * video.videoHeight,
          searchBox.width * video.videoWidth,
          searchBox.height * video.videoHeight,
          0,
          0,
          targetCanvas.width,
          targetCanvas.height,
        );
      } else {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
      }
      const result = detector?.detect(inferenceCanvas);
      const candidates = result?.detections
        .filter((detection) => detection.categories.some((category) => ["dog", "cat"].includes(category.categoryName.toLowerCase())))
        .map((detection) => {
          const detectedBox = detection.boundingBox;
          if (!detectedBox) return null;
          const localBox = {
            x: detectedBox.originX / inferenceCanvas.width,
            y: detectedBox.originY / inferenceCanvas.height,
            width: detectedBox.width / inferenceCanvas.width,
            height: detectedBox.height / inferenceCanvas.height,
          };
          const mappedBox = searchBox ? {
            x: searchBox.x + localBox.x * searchBox.width,
            y: searchBox.y + localBox.y * searchBox.height,
            width: localBox.width * searchBox.width,
            height: localBox.height * searchBox.height,
          } : localBox;
          const category = detection.categories
            .filter((item) => ["dog", "cat"].includes(item.categoryName.toLowerCase()))
            .sort((left, right) => right.score - left.score)[0];
          return {
            detection,
            box: mappedBox,
            confidence: category?.score ?? 0,
            petKind: category?.categoryName.toLowerCase() as PetKind | undefined,
          };
        })
        .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
        .sort((left, right) => {
          if (!ownerGuided || !lastBox) return right.confidence - left.confidence;
          const leftScore = left.confidence - boxCenterDistance(left.box, lastBox) * 0.9;
          const rightScore = right.confidence - boxCenterDistance(right.box, lastBox) * 0.9;
          return rightScore - leftScore;
        });
      const candidate = candidates?.[0];
      let readingBox: DogBox | null = null;
      let visible = false;
      let confidence = candidate?.confidence ?? 0;
      if (candidate) {
        const nextBox = paddedBox(candidate.box);
        lastBox = smoothBox(lastBox, nextBox);
        lastConfidence = confidence;
        consecutiveMisses = 0;
        trackingUntil = Date.now() + TRACKING_GRACE_MS;
        readingBox = lastBox;
        visible = true;
        lastPetKind = candidate.petKind ?? lastPetKind;
      } else if (lastBox && Date.now() < trackingUntil) {
        consecutiveMisses += 1;
        confidence = lastConfidence * Math.pow(0.86, consecutiveMisses);
        readingBox = lastBox;
        visible = true;
      } else {
        consecutiveMisses = 0;
        lastBox = null;
        lastConfidence = 0;
      }
      onReading({
        visible,
        confidence,
        box: readingBox,
        petKind: visible ? lastPetKind : null,
        targetMode: ownerGuided ? "owner_guided" : "auto",
        inferenceMs: performance.now() - startedAt,
        observedAt: Date.now(),
      });
    } catch {
      ready = false;
      onStatus("unavailable");
      if (retryTimer != null) window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(initialize, RETRY_INTERVAL_MS);
    } finally {
      inFlight = false;
      if (ready) schedule();
    }
  };

  const initialize = async () => {
    if (stopped || initializing) return;
    initializing = true;
    ready = false;
    onStatus("loading");
    try {
      detector?.close();
      // MediaPipe's WASM resolver touches `document`, so initialization must stay on the browser main thread.
      const { FilesetResolver, ObjectDetector } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
      detector = await ObjectDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
        runningMode: "IMAGE",
        categoryAllowlist: ["dog", "cat"],
        maxResults: 3,
        scoreThreshold: 0.2,
      });
      if (stopped) {
        detector.close();
        detector = null;
        return;
      }
      ready = true;
      onStatus("ready");
      schedule(100);
    } catch {
      onStatus("unavailable");
      retryTimer = window.setTimeout(initialize, RETRY_INTERVAL_MS);
    } finally {
      initializing = false;
    }
  };

  void initialize();

  return {
    setMotionActive(active) {
      if (active) {
        activeUntil = Date.now() + 15_000;
        if (!inFlight) schedule(100);
      }
    },
    setTargetBox(box) {
      ownerGuided = box !== null;
      if (box) {
        lastBox = paddedBox(box);
        lastConfidence = 0.5;
        consecutiveMisses = 0;
        trackingUntil = Date.now() + 10_000;
      }
      if (!inFlight) schedule(50);
    },
    retry() {
      if (retryTimer != null) window.clearTimeout(retryTimer);
      void initialize();
    },
    stop() {
      stopped = true;
      if (timer != null) window.clearTimeout(timer);
      if (retryTimer != null) window.clearTimeout(retryTimer);
      detector?.close();
      detector = null;
    },
  };
}
