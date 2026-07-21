export type DogDetectorStatus = "loading" | "ready" | "unavailable";

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
  inferenceMs: number;
  observedAt: number;
}

export interface DogDetectorController {
  setMotionActive(active: boolean): void;
  stop(): void;
}

interface WorkerResult {
  type: "ready" | "result" | "error";
  visible?: boolean;
  confidence?: number;
  box?: DogBox | null;
  inferenceMs?: number;
  message?: string;
}

const SETTLED_INTERVAL_MS = 12_000;
const ACTIVE_INTERVAL_MS = 1_500;

export function startDogDetector(
  video: HTMLVideoElement,
  onReading: (reading: DogReading) => void,
  onStatus: (status: DogDetectorStatus) => void,
): DogDetectorController {
  const worker = new Worker(new URL("./dog-detector.worker.ts", import.meta.url), { type: "module" });
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const context = canvas.getContext("2d", { alpha: false });
  let timer: number | null = null;
  let stopped = false;
  let ready = false;
  let inFlight = false;
  let frameId = 0;
  let activeUntil = 0;

  const schedule = (delay?: number) => {
    if (stopped) return;
    if (timer != null) window.clearTimeout(timer);
    const interval = Date.now() < activeUntil ? ACTIVE_INTERVAL_MS : SETTLED_INTERVAL_MS;
    timer = window.setTimeout(capture, delay ?? interval);
  };

  const capture = async () => {
    if (stopped) return;
    if (!ready || inFlight || !context || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      schedule(1_000);
      return;
    }
    try {
      inFlight = true;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const bitmap = await createImageBitmap(canvas);
      worker.postMessage({ type: "frame", id: ++frameId, bitmap }, [bitmap]);
    } catch {
      inFlight = false;
      schedule(2_000);
    }
  };

  worker.onmessage = (event: MessageEvent<WorkerResult>) => {
    const message = event.data;
    if (message.type === "ready") {
      ready = true;
      onStatus("ready");
      schedule(100);
      return;
    }
    if (message.type === "error") {
      inFlight = false;
      onStatus("unavailable");
      schedule(15_000);
      return;
    }
    inFlight = false;
    onReading({
      visible: Boolean(message.visible),
      confidence: message.confidence ?? 0,
      box: message.box ?? null,
      inferenceMs: message.inferenceMs ?? 0,
      observedAt: Date.now(),
    });
    schedule();
  };
  worker.onerror = () => {
    inFlight = false;
    onStatus("unavailable");
  };

  onStatus("loading");
  worker.postMessage({ type: "init" });

  return {
    setMotionActive(active) {
      if (active) {
        activeUntil = Date.now() + 15_000;
        if (!inFlight) schedule(100);
      }
    },
    stop() {
      stopped = true;
      if (timer != null) window.clearTimeout(timer);
      worker.terminate();
    },
  };
}

