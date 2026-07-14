// Werkzeichnung: bemasste 2D-Ansichten (Vorderansicht, Seitenansicht, Draufsicht)
// als SVG-Zeichnungsblatt (A3 quer, Erstwinkelprojektion vereinfacht).
// Alle Papiermasse in mm; Modellmasse werden über den Massstab abgebildet.

import { WOODS } from './wood';
import type { Assembly, CabinetParams, PartSpec } from './types';

const SHEET_W = 420; // A3 quer
const SHEET_H = 297;
const MARGIN = 12;
const GAP = 26; // Platz zwischen Ansichten (für Masslinien)
const SCALES = [2, 5, 10, 20]; // 1:n

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Sortierwert entlang der Blickachse (grösser = näher am Betrachter) */
  depth: number;
  part: PartSpec;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function boundingSize(p: PartSpec): [number, number, number] {
  if (p.shape === 'cylinder') {
    const d = p.size[0];
    const len = p.size[1];
    if (p.axis === 'x') return [len, d, d];
    if (p.axis === 'z') return [d, d, len];
    return [d, len, d];
  }
  return p.size;
}

/** Projektion eines Bauteils auf eine Ansichtsebene. h/v: Modellachsen-Index (0=x,1=y,2=z) */
function project(parts: PartSpec[], h: 0 | 1 | 2, v: 0 | 1 | 2, d: 0 | 1 | 2, flipD = false): Rect[] {
  const rects = parts.map((part) => {
    const size = boundingSize(part);
    return {
      x: part.position[h] - size[h] / 2,
      y: part.position[v] - size[v] / 2,
      w: size[h],
      h: size[v],
      depth: (flipD ? -1 : 1) * part.position[d],
      part,
    };
  });
  rects.sort((a, b) => a.depth - b.depth); // ferne zuerst (Painter-Algorithmus)
  return rects;
}

export function buildDrawingSvg(assembly: Assembly, params: CabinetParams): string {
  const { width: W, height: H } = assembly.overall;
  const Dtot = assembly.overall.depth;

  // Zeichenbare Teile: Dübel sind innenliegend und entfallen
  const parts = assembly.parts.filter((p) => p.groupKey !== 'Holzdübel');

  // Massstab wählen: Vorder- + Seitenansicht nebeneinander, Draufsicht darunter
  const areaW = SHEET_W - 2 * MARGIN - 20;
  const areaH = SHEET_H - 2 * MARGIN - 34; // Platz für Titelblock
  const scale = SCALES.find(
    (s) => (W + Dtot) / s + GAP + 24 <= areaW && (H + Dtot) / s + GAP + 18 <= areaH,
  ) ?? 20;
  const k = 1 / scale;

  const out: string[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number, cls = 'edge') =>
    out.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" class="${cls}"/>`);
  const text = (x: number, y: number, s: string, cls = 'lbl', anchor = 'middle') =>
    out.push(`<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" class="${cls}" text-anchor="${anchor}">${esc(s)}</text>`);

  // Ansicht zeichnen; liefert Papier-Bounding-Box zurück
  function drawView(
    rects: Rect[],
    ox: number,
    oy: number,
    modelMinX: number,
    modelMaxY: number,
    label: string,
    dashedGroups: string[],
  ): void {
    let maxPy = oy;
    for (const r of rects) {
      const px = ox + (r.x - modelMinX) * k;
      const py = oy + (modelMaxY - (r.y + r.h)) * k;
      maxPy = Math.max(maxPy, py + r.h * k);
      out.push(
        `<rect x="${px.toFixed(2)}" y="${py.toFixed(2)}" width="${(r.w * k).toFixed(2)}" height="${(r.h * k).toFixed(2)}" class="part"/>`,
      );
    }
    // Verdeckte Kanten (gestrichelt) für innenliegende Gruppen
    for (const r of rects) {
      if (!dashedGroups.includes(r.part.groupKey)) continue;
      const px = ox + (r.x - modelMinX) * k;
      const py = oy + (modelMaxY - (r.y + r.h)) * k;
      out.push(
        `<rect x="${px.toFixed(2)}" y="${py.toFixed(2)}" width="${(r.w * k).toFixed(2)}" height="${(r.h * k).toFixed(2)}" class="hidden-edge"/>`,
      );
    }
    text(ox, maxPy + 5.2, label, 'view-label', 'start');
  }

  // Masslinie mit Pfeilen, Hilfslinien und Text
  function dim(x1: number, y1: number, x2: number, y2: number, value: number, extA: [number, number], extB: [number, number]): void {
    line(extA[0], extA[1], x1, y1, 'ext');
    line(extB[0], extB[1], x2, y2, 'ext');
    out.push(
      `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" class="dim" marker-start="url(#arr)" marker-end="url(#arr)"/>`,
    );
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const vertical = Math.abs(x2 - x1) < Math.abs(y2 - y1);
    if (vertical) {
      out.push(`<text x="${(mx - 1.6).toFixed(2)}" y="${my.toFixed(2)}" class="dim-text" text-anchor="middle" transform="rotate(-90 ${(mx - 1.6).toFixed(2)} ${my.toFixed(2)})">${value}</text>`);
    } else {
      text(mx, my - 1.6, String(value), 'dim-text');
    }
  }

  // --- Layout ---------------------------------------------------------------
  const frontW = W * k;
  const frontH = H * k;
  const depthW = Dtot * k;
  const ox1 = MARGIN + 14; // Vorderansicht (Platz für Höhenmass links)
  const oy1 = MARGIN + 14;
  const ox2 = ox1 + frontW + GAP; // Seitenansicht rechts daneben
  const oy3 = oy1 + frontH + GAP; // Draufsicht unter der Vorderansicht

  const dashed = ['Einlegeboden'];

  // Vorderansicht: h=x, v=y, Blick entlang -z (nahe = grosses z)
  drawView(project(parts, 0, 1, 2), ox1, oy1, -W / 2, H / 2, 'Vorderansicht', dashed);
  // Seitenansicht von rechts: h=z (Front links), v=y, Blick entlang -x
  const sideParts = project(parts, 2, 1, 0).map((r) => ({ ...r, x: -(r.x + r.w) }));
  const sideMinX = Math.min(...sideParts.map((r) => r.x));
  drawView(sideParts, ox2, oy1, sideMinX, H / 2, 'Seitenansicht von rechts', dashed);
  // Draufsicht: h=x, v=z (Front unten), Blick entlang -y (nahe = grosses y)
  const topParts = project(parts, 0, 2, 1).map((r) => ({ ...r, y: -(r.y + r.h) }));
  const topMinY = Math.min(...topParts.map((r) => r.y));
  drawView(topParts, ox1, oy3, -W / 2, topMinY + Dtot, 'Draufsicht', []);

  // --- Bemassung -------------------------------------------------------------
  // Breite über der Vorderansicht
  dim(ox1, oy1 - 6, ox1 + frontW, oy1 - 6, W, [ox1, oy1], [ox1 + frontW, oy1]);
  // Höhe links der Vorderansicht
  dim(ox1 - 6, oy1, ox1 - 6, oy1 + frontH, H, [ox1, oy1], [ox1, oy1 + frontH]);
  // Tiefe über der Seitenansicht
  dim(ox2, oy1 - 6, ox2 + depthW, oy1 - 6, Dtot, [ox2, oy1], [ox2 + depthW, oy1]);

  // --- Blattrahmen & Titelblock ----------------------------------------------
  const frame = `<rect x="${MARGIN}" y="${MARGIN}" width="${SHEET_W - 2 * MARGIN}" height="${SHEET_H - 2 * MARGIN}" class="frame"/>`;
  const tbW = 132;
  const tbH = 26;
  const tbX = SHEET_W - MARGIN - tbW;
  const tbY = SHEET_H - MARGIN - tbH;
  const material = WOODS[params.materialKey]?.label ?? params.materialKey;
  const date = new Date().toISOString().slice(0, 10);
  const titleBlock = [
    `<rect x="${tbX}" y="${tbY}" width="${tbW}" height="${tbH}" class="frame"/>`,
    `<line x1="${tbX}" y1="${tbY + 9}" x2="${tbX + tbW}" y2="${tbY + 9}" class="frame"/>`,
    `<line x1="${tbX + 66}" y1="${tbY + 9}" x2="${tbX + 66}" y2="${tbY + tbH}" class="frame"/>`,
    `<text x="${tbX + 3}" y="${tbY + 6.4}" class="tb-title" text-anchor="start">Hängeschrank — ${W} × ${H} × ${assembly.overall.depth} mm</text>`,
    `<text x="${tbX + 3}" y="${tbY + 14.5}" class="tb" text-anchor="start">Material: ${esc(material)}, ${params.thickness} mm</text>`,
    `<text x="${tbX + 3}" y="${tbY + 21.5}" class="tb" text-anchor="start">Rückwand: HDF 8 mm, eingenutet</text>`,
    `<text x="${tbX + 69}" y="${tbY + 14.5}" class="tb" text-anchor="start">Massstab 1:${scale} · Masse in mm</text>`,
    `<text x="${tbX + 69}" y="${tbY + 21.5}" class="tb" text-anchor="start">SchreinerCAD · ${date}</text>`,
  ].join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SHEET_W} ${SHEET_H}" font-family="'Segoe UI', sans-serif">
<defs>
  <marker id="arr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
    <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="#1c2b4a"/>
  </marker>
</defs>
<style>
  .bg { fill: #ffffff; }
  .frame { fill: none; stroke: #1c2b4a; stroke-width: 0.5; }
  .part { fill: #fbf7ef; stroke: #2b2f33; stroke-width: 0.45; }
  .hidden-edge { fill: none; stroke: #2b2f33; stroke-width: 0.3; stroke-dasharray: 2.2 1.4; }
  .edge { stroke: #2b2f33; stroke-width: 0.45; }
  .ext { stroke: #1c2b4a; stroke-width: 0.2; }
  .dim { stroke: #1c2b4a; stroke-width: 0.28; }
  .dim-text { font-size: 3.6px; fill: #1c2b4a; }
  .view-label { font-size: 3.8px; fill: #2b2f33; font-weight: 600; }
  .tb-title { font-size: 4px; fill: #1c2b4a; font-weight: 600; }
  .tb { font-size: 3.2px; fill: #2b2f33; }
</style>
<rect width="${SHEET_W}" height="${SHEET_H}" class="bg"/>
${frame}
${out.join('\n')}
${titleBlock}
</svg>`;
}
