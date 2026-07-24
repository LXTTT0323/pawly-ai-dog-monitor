import type { DogBox } from "./dog-detector";

export interface DragSelection {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export interface VideoViewport {
  width: number;
  height: number;
  videoWidth: number;
  videoHeight: number;
  zoom: number;
}

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

/**
 * Converts a rectangle drawn over an object-fit: cover video into normalized
 * coordinates in the original camera frame. The view can also be digitally
 * zoomed around its center.
 */
export function dragSelectionToVideoBox(
  selection: DragSelection,
  viewport: VideoViewport,
): DogBox | null {
  if (
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    viewport.videoWidth <= 0 ||
    viewport.videoHeight <= 0
  ) return null;

  const zoom = Math.max(1, viewport.zoom);
  const scale = Math.max(
    viewport.width / viewport.videoWidth,
    viewport.height / viewport.videoHeight,
  );
  const renderedWidth = viewport.videoWidth * scale;
  const renderedHeight = viewport.videoHeight * scale;
  const offsetX = (viewport.width - renderedWidth) / 2;
  const offsetY = (viewport.height - renderedHeight) / 2;

  const mapPoint = (x: number, y: number) => {
    const unzoomedX = viewport.width / 2 + (x - viewport.width / 2) / zoom;
    const unzoomedY = viewport.height / 2 + (y - viewport.height / 2) / zoom;
    return {
      x: clamp((unzoomedX - offsetX) / renderedWidth),
      y: clamp((unzoomedY - offsetY) / renderedHeight),
    };
  };

  const start = mapPoint(selection.startX, selection.startY);
  const end = mapPoint(selection.endX, selection.endY);
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);

  if (width < 0.015 || height < 0.015) return null;
  return { x, y, width, height };
}
