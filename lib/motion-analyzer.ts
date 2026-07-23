export interface MotionReading {
  score: number;
  active: boolean;
  cameraShift: boolean;
  shiftX: number;
  shiftY: number;
  intervalMs: number;
}

const CALM_INTERVAL_MS = 2_000;
const ACTIVE_INTERVAL_MS = 750;

export function estimateCameraShift(
  previous: Uint8ClampedArray,
  current: Uint8ClampedArray,
  width: number,
  height: number,
) {
  const searchRadius = 4;
  const sampleStep = 2;
  let baselineError = 0;
  let bestError = Number.POSITIVE_INFINITY;
  let bestX = 0;
  let bestY = 0;

  for (let offsetY = -searchRadius; offsetY <= searchRadius; offsetY += 1) {
    for (let offsetX = -searchRadius; offsetX <= searchRadius; offsetX += 1) {
      let error = 0;
      let samples = 0;
      for (let y = searchRadius; y < height - searchRadius; y += sampleStep) {
        for (let x = searchRadius; x < width - searchRadius; x += sampleStep) {
          error += Math.abs(current[y * width + x] - previous[(y + offsetY) * width + x + offsetX]);
          samples += 1;
        }
      }
      const averageError = samples ? error / samples : Number.POSITIVE_INFINITY;
      if (offsetX === 0 && offsetY === 0) baselineError = averageError;
      if (averageError < bestError) {
        bestError = averageError;
        bestX = offsetX;
        bestY = offsetY;
      }
    }
  }

  const magnitudePixels = Math.hypot(bestX, bestY);
  const improvement = baselineError > 0 ? Math.max(0, (baselineError - bestError) / baselineError) : 0;
  return {
    shiftX: -bestX / width,
    shiftY: -bestY / height,
    magnitudePixels,
    improvement,
  };
}

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
      let changedPixels = 0;

      for (let index = 0, pixel = 0; index < pixels.length; index += 4, pixel += 1) {
        grayscale[pixel] = (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
        if (previous) {
          const difference = Math.abs(grayscale[pixel] - previous[pixel]);
          totalDifference += difference;
          if (difference >= 24) changedPixels += 1;
        }
      }

      if (previous) {
        const score = totalDifference / grayscale.length / 255;
        const changedPixelRatio = changedPixels / grayscale.length;
        const shift = estimateCameraShift(previous, grayscale, canvas.width, canvas.height);
        const translatedBackground = score >= 0.025 && shift.magnitudePixels >= 1.4 && shift.improvement >= 0.1;
        const abruptWholeFrameChange = score >= 0.1 && changedPixelRatio >= 0.65;
        const cameraShift = translatedBackground || abruptWholeFrameChange;
        const active = score > 0.065;
        onReading({
          score,
          active,
          cameraShift,
          shiftX: shift.shiftX,
          shiftY: shift.shiftY,
          intervalMs: nextIntervalMs,
        });
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
