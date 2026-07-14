// Bohrbild-DXF für die CNC: je Zuschnittteil die Kontur (L × B) plus alle
// Bohrungen, abgeleitet aus den Zylinderteilen des Modells (Dübel,
// Bodenträger, Scharniertöpfe), die das Brett durchdringen.
//
// Flächenbohrungen (Achse ⊥ Brettfläche) liegen als Kreise in der Kontur,
// Kantenbohrungen (Dübel in die Schmalseite) als Kreise auf der Kante.
// Layer: TEILKONTUR, BOHRUNG_FLAECHE, BOHRUNG_KANTE, BESCHRIFTUNG.

import type { Assembly, GrainAxis, PartSpec } from './types';

const AXES: GrainAxis[] = ['x', 'y', 'z'];
const EPS = 0.5;

interface Bore {
  u: number;
  v: number;
  diameter: number;
  depth: number;
  kind: 'flaeche' | 'kante';
}

interface PartPlan {
  part: PartSpec;
  length: number;
  width: number;
  bores: Bore[];
}

function axisIndex(a: GrainAxis): 0 | 1 | 2 {
  return AXES.indexOf(a) as 0 | 1 | 2;
}

function boxSize(p: PartSpec): [number, number, number] {
  return p.size;
}

/** Achse, deren Ausdehnung der Brettstärke entspricht */
function thicknessAxis(p: PartSpec): 0 | 1 | 2 {
  const t = p.cut!.thickness;
  let best: 0 | 1 | 2 = 0;
  let bestDiff = Infinity;
  for (const i of [0, 1, 2] as const) {
    const diff = Math.abs(p.size[i] - t);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return best;
}

/** Achse, deren Ausdehnung der Zuschnittlänge entspricht (≠ Stärkenachse) */
function lengthAxis(p: PartSpec, tAxis: 0 | 1 | 2): 0 | 1 | 2 {
  const l = p.cut!.length;
  let best: 0 | 1 | 2 = tAxis === 0 ? 1 : 0;
  let bestDiff = Infinity;
  for (const i of [0, 1, 2] as const) {
    if (i === tAxis) continue;
    const diff = Math.abs(p.size[i] - l);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return best;
}

export function buildPartPlans(assembly: Assembly): PartPlan[] {
  const boards = assembly.parts.filter((p) => p.shape === 'box' && p.cut);
  const cylinders = assembly.parts.filter((p) => p.shape === 'cylinder' && p.axis);
  const plans: PartPlan[] = [];

  for (const board of boards) {
    const tAxis = thicknessAxis(board);
    const lAxis = lengthAxis(board, tAxis);
    const wAxis = ([0, 1, 2] as const).find((i) => i !== tAxis && i !== lAxis)!;
    const size = boxSize(board);
    const min = board.position.map((c, i) => c - size[i] / 2) as [number, number, number];
    const max = board.position.map((c, i) => c + size[i] / 2) as [number, number, number];
    const bores: Bore[] = [];

    for (const cyl of cylinders) {
      const a = axisIndex(cyl.axis!);
      const d = cyl.size[0];
      const len = cyl.size[1];
      const r = d / 2;
      // Bounding-Box des Zylinders
      const cMin: number[] = [];
      const cMax: number[] = [];
      for (const i of [0, 1, 2] as const) {
        const half = i === a ? len / 2 : r;
        cMin.push(cyl.position[i] - half);
        cMax.push(cyl.position[i] + half);
      }
      const overlaps = [0, 1, 2].every((i) => cMin[i] < max[i] - EPS && cMax[i] > min[i] + EPS);
      if (!overlaps) continue;
      // Die Bohrachse muss das Brett wirklich treffen: Zylinder-Mittellinie
      // liegt in beiden Querachsen innerhalb des Bretts (kein Streifschuss).
      const centered = ([0, 1, 2] as const).every(
        (i) => i === a || (cyl.position[i] >= min[i] - EPS && cyl.position[i] <= max[i] + EPS),
      );
      if (!centered) continue;
      // Eindringtiefe entlang der Zylinderachse
      const depth = Math.min(cMax[a], max[a]) - Math.max(cMin[a], min[a]);
      if (depth < 2) continue;

      // Position im Teil-Koordinatensystem (u entlang Länge, v entlang Breite)
      const u = cyl.position[lAxis] - min[lAxis];
      const v = cyl.position[wAxis] - min[wAxis];

      if (a === tAxis) {
        bores.push({ u, v, diameter: d, depth: Math.min(depth, size[tAxis]), kind: 'flaeche' });
      } else {
        // Kantenbohrung: auf der Kante liegt die Koordinate der Achse a am Rand
        const uu = a === lAxis ? (cyl.position[a] > board.position[a] ? board.cut!.length : 0) : u;
        const vv = a === wAxis ? (cyl.position[a] > board.position[a] ? board.cut!.width : 0) : v;
        bores.push({ u: uu, v: vv, diameter: d, depth, kind: 'kante' });
      }
    }

    plans.push({ part: board, length: board.cut!.length, width: board.cut!.width, bores });
  }
  return plans;
}

/** Alle Teile mit Bohrbildern als ein DXF (Teile im Raster angeordnet). */
export function buildPartsDxf(assembly: Assembly): string {
  const plans = buildPartPlans(assembly);
  const e: string[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number, layer: string) =>
    e.push('0', 'LINE', '8', layer, '10', x1.toFixed(1), '20', y1.toFixed(1), '11', x2.toFixed(1), '21', y2.toFixed(1));
  const circle = (x: number, y: number, r: number, layer: string) =>
    e.push('0', 'CIRCLE', '8', layer, '10', x.toFixed(1), '20', y.toFixed(1), '40', r.toFixed(2));
  const text = (x: number, y: number, h: number, value: string, layer: string) =>
    e.push('0', 'TEXT', '8', layer, '10', x.toFixed(1), '20', y.toFixed(1), '40', String(h), '1', value);

  const gap = 150;
  let ox = 0;
  let oy = 0;
  let rowH = 0;
  const maxRowW = 3600;

  for (const plan of plans) {
    if (ox + plan.length > maxRowW && ox > 0) {
      oy -= rowH + gap;
      ox = 0;
      rowH = 0;
    }
    // Kontur
    line(ox, oy, ox + plan.length, oy, 'TEILKONTUR');
    line(ox + plan.length, oy, ox + plan.length, oy + plan.width, 'TEILKONTUR');
    line(ox + plan.length, oy + plan.width, ox, oy + plan.width, 'TEILKONTUR');
    line(ox, oy + plan.width, ox, oy, 'TEILKONTUR');
    text(ox, oy - 60, 40, `${plan.part.name} ${plan.length}x${plan.width}x${plan.part.cut!.thickness}`, 'BESCHRIFTUNG');

    for (const bore of plan.bores) {
      const layer = bore.kind === 'flaeche' ? 'BOHRUNG_FLAECHE' : 'BOHRUNG_KANTE';
      circle(ox + bore.u, oy + bore.v, bore.diameter / 2, layer);
      text(
        ox + bore.u + bore.diameter / 2 + 4,
        oy + bore.v,
        18,
        `o${bore.diameter} t${bore.depth.toFixed(0)}`,
        'BESCHRIFTUNG',
      );
    }

    ox += plan.length + gap;
    rowH = Math.max(rowH, plan.width);
  }

  return ['0', 'SECTION', '2', 'ENTITIES', ...e, '0', 'ENDSEC', '0', 'EOF'].join('\r\n');
}
