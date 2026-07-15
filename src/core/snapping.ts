// Fang-Logik (Snapping) für 3D-Bewegen und 2D-Skizze:
// 1. Bauteil-Fang: Kanten/Flächen des bewegten Teils rasten auf Kanten
//    anderer Teile ein (bündig oder anstossend), Toleranz in mm.
// 2. Raster-Fang: sonst Rundung auf das eingestellte Raster.

export interface AxisBox {
  min: number;
  max: number;
}

/**
 * Beste eingerastete Mittelpunkt-Koordinate für eine Achse.
 * half = halbe Ausdehnung des bewegten Teils auf dieser Achse.
 */
export function snapAxis(
  rawCenter: number,
  half: number,
  others: AxisBox[],
  grid: number,
  tolerance: number,
): number {
  const myMin = rawCenter - half;
  const myMax = rawCenter + half;
  let bestDelta = Infinity;
  for (const other of others) {
    // bündig min-min / max-max, anstossend min-max / max-min, plus Mitte-Mitte
    const candidates = [
      other.min - myMin,
      other.max - myMax,
      other.max - myMin,
      other.min - myMax,
      (other.min + other.max) / 2 - rawCenter,
    ];
    for (const delta of candidates) {
      if (Math.abs(delta) <= tolerance && Math.abs(delta) < Math.abs(bestDelta)) {
        bestDelta = delta;
      }
    }
  }
  if (Number.isFinite(bestDelta)) return rawCenter + bestDelta;
  return grid > 0 ? Math.round(rawCenter / grid) * grid : rawCenter;
}

/** Einzelwert (z.B. Skizzenkante) auf Kanten oder Raster fangen. */
export function snapValue(raw: number, edges: number[], grid: number, tolerance: number): number {
  let best = Infinity;
  for (const edge of edges) {
    const delta = edge - raw;
    if (Math.abs(delta) <= tolerance && Math.abs(delta) < Math.abs(best)) best = delta;
  }
  if (Number.isFinite(best)) return raw + best;
  return grid > 0 ? Math.round(raw / grid) * grid : raw;
}
