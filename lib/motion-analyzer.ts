export interface MotionReading {
  score: number;
  active: boolean;
  intervalMs: number;
}

const CALM_INTERVAL_MS = 2_000;
const ACTIVE_INTERVAL_MS = 750;

export function startMotionAnalyzer(
  video: HTMLVideoElement,
  onReading: (reading: MotionReading) => void,
): () => void {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 54;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  let previous: Uint8ClampedArray | null = null;
  let cancelled = false;
  let timer: number | null = null;
  let nextIntervalMs = CALM_INTERVAL_MS;

  const tick = () => {
    if (cancelled || !context) return;
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const grayscale = new Uint8ClampedArray(canvas.width * canvas.height);
      let totalDifference = 0;

      for (let index = 0, pixel = 0; index < pixels.length; index += 4, pixel += 1) {
        grayscale[pixel] = (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
        if (previous) totalDifference += Math.abs(grayscale[pixel] - previous[pixel]);
      }

      if (previous) {
        const score = totalDifference / grayscale.length / 255;
        const active = score > 0.065;
        onReading({ score, active, intervalMs: nextIntervalMs });
        nextIntervalMs = active ? ACTIVE_INTERVAL_MS : CALM_INTERVAL_MS;
      }
      previous = grayscale;
    }
    timer = window.setTimeout(tick, nextIntervalMs);
  };

  timer = window.setTimeout(tick, 250);
  return () => {
    cancelled = true;
    if (timer != null) window.clearTimeout(timer);
  };
}
