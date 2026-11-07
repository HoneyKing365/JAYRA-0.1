export interface NormalizedPoint {
  x: number;
  y: number;
}

export function mapCursorPoint(point: NormalizedPoint, sensitivity: number): NormalizedPoint {
  const scale = Number.isFinite(sensitivity) ? Math.max(0.1, Math.min(3, sensitivity)) : 1;
  return {
    x: Math.max(0, Math.min(1, 0.5 + (point.x - 0.5) * scale)),
    y: Math.max(0, Math.min(1, 0.5 + (point.y - 0.5) * scale)),
  };
}

export function isPinchActive(distance: number, currentlyPinching: boolean): boolean {
  return distance < (currentlyPinching ? 0.42 : 0.3);
}

export function getTwoHandZoomDelta(previous: number | null, current: number): number | null {
  if (previous === null || !Number.isFinite(current) || previous <= 0) return null;
  const delta = current / previous - 1;
  return Math.abs(delta) >= 0.025 ? delta : null;
}
