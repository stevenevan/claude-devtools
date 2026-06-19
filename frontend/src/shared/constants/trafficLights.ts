const MACOS_TRAFFIC_LIGHT_BASE_POSITION = { x: 12, y: 12 } as const;
export const HEADER_ROW1_HEIGHT = 40;
const MACOS_TRAFFIC_LIGHT_GROUP_WIDTH = 52;
const MACOS_TRAFFIC_LIGHT_CONTENT_GAP = 16;

const MIN_ZOOM_FACTOR = 0.25;

function sanitizeZoomFactor(zoomFactor: number): number {
  if (!Number.isFinite(zoomFactor) || zoomFactor <= 0) {
    return 1;
  }
  return Math.max(zoomFactor, MIN_ZOOM_FACTOR);
}

export function getTrafficLightPaddingForZoom(zoomFactor: number): number {
  const zoom = sanitizeZoomFactor(zoomFactor);
  return Math.ceil(
    MACOS_TRAFFIC_LIGHT_BASE_POSITION.x +
      (MACOS_TRAFFIC_LIGHT_GROUP_WIDTH + MACOS_TRAFFIC_LIGHT_CONTENT_GAP) / zoom
  );
}
