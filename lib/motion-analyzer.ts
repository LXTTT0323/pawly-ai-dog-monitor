export interface MotionReading {
  score: number;
  active: boolean;
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
        onReading({ score, active: score > 0.065 });
      }
      previous = grayscale;
    }
  };

  const interval = window.setInterval(tick, 1000);
  return () => {
    cancelled = true;
    window.clearInterval(interval);
  };
}
