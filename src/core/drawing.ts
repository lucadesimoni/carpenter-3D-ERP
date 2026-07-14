// Werkzeichnung: bemasste 2D-Ansichten als Zeichnungssatz (A3 quer).
//   Blatt 1 — Vorder-/Seiten-/Draufsicht mit Positionsnummern (Ballons),
//             Bemassung, Stücklisten-Block und Titelblock.
//   Blatt 2 — Montagefolge: je Montagestufe eine Teilansicht, neue Teile
//             hervorgehoben, mit Stufenname und Teileliste.
// Alle Papiermasse in mm; Modellmasse werden über den Massstab abgebildet.

import { buildCutlist } from './cutlist';
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

/** Projektion auf eine Ansichtsebene. h/v/d: Modellachsen-Index (0=x,1=y,2=z) */
function project(parts: PartSpec[], h: 0 | 1 | 2, v: 0 | 1 | 2, d: 0 | 1 | 2): Rect[] {
  const rects = parts.map((part) => {
    const size = boundingSize(part);
    return {
      x: part.position[h] - size[h] / 2,
      y: part.position[v] - size[v] / 2,
      w: size[h],
      h: size[v],
      depth: part.position[d],
      part,
    };
  });
  rects.sort((a, b) => a.depth - b.depth); // ferne zuerst (Painter-Algorithmus)
  return rects;
}

const SVG_STYLE = `
  .bg { fill: #ffffff; }
  .frame { fill: none; stroke: #1c2b4a; stroke-width: 0.5; }
  .part { fill: #fbf7ef; stroke: #2b2f33; stroke-width: 0.45; }
  .part-new { fill: #fde8cd; stroke: #c05f00; stroke-width: 0.6; }
  .hidden-edge { fill: none; stroke: #2b2f33; stroke-width: 0.3; stroke-dasharray: 2.2 1.4; }
  .ext { stroke: #1c2b4a; stroke-width: 0.2; }
  .dim { stroke: #1c2b4a; stroke-width: 0.28; }
  .dim-text { font-size: 3.6px; fill: #1c2b4a; }
  .view-label { font-size: 3.8px; fill: #2b2f33; font-weight: 600; }
  .tb-title { font-size: 4px; fill: #1c2b4a; font-weight: 600; }
  .tb { font-size: 3.2px; fill: #2b2f33; }
  .bom { font-size: 2.7px; fill: #2b2f33; }
  .bom-head { font-size: 2.7px; fill: #1c2b4a; font-weight: 600; }
  .balloon { fill: #ffffff; stroke: #c05f00; stroke-width: 0.4; }
  .balloon-text { font-size: 3px; fill: #c05f00; font-weight: 600; }
  .step-title { font-size: 3.6px; fill: #1c2b4a; font-weight: 600; }
  .step-parts { font-size: 2.8px; fill: #6d6455; }
`;

function sheetShell(content: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SHEET_W} ${SHEET_H}" font-family="'Segoe UI', sans-serif">
<defs>
  <marker id="arr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
    <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="#1c2b4a"/>
  </marker>
</defs>
<style>${SVG_STYLE}</style>
<rect width="${SHEET_W}" height="${SHEET_H}" class="bg"/>
<rect x="${MARGIN}" y="${MARGIN}" width="${SHEET_W - 2 * MARGIN}" height="${SHEET_H - 2 * MARGIN}" class="frame"/>
${content}
</svg>`;
}

function titleBlock(assembly: Assembly, params: CabinetParams, sheetNo: number, sheetName: string): string {
  const tbW = 132;
  const tbH = 26;
  const tbX = SHEET_W - MARGIN - tbW;
  const tbY = SHEET_H - MARGIN - tbH;
  const material = WOODS[params.materialKey]?.label ?? params.materialKey;
  const date = new Date().toISOString().slice(0, 10);
  return [
    `<rect x="${tbX}" y="${tbY}" width="${tbW}" height="${tbH}" class="frame"/>`,
    `<line x1="${tbX}" y1="${tbY + 9}" x2="${tbX + tbW}" y2="${tbY + 9}" class="frame"/>`,
    `<line x1="${tbX + 66}" y1="${tbY + 9}" x2="${tbX + 66}" y2="${tbY + tbH}" class="frame"/>`,
    `<text x="${tbX + 3}" y="${tbY + 6.4}" class="tb-title" text-anchor="start">${esc(assembly.name)} — ${assembly.overall.width} × ${assembly.overall.height} × ${assembly.overall.depth} mm</text>`,
    `<text x="${tbX + 3}" y="${tbY + 14.5}" class="tb" text-anchor="start">Material: ${esc(material)}, ${params.thickness} mm</text>`,
    `<text x="${tbX + 3}" y="${tbY + 21.5}" class="tb" text-anchor="start">${esc(assembly.subtitle.length > 38 ? assembly.subtitle.slice(0, 37) + '…' : assembly.subtitle)}</text>`,
    `<text x="${tbX + 69}" y="${tbY + 14.5}" class="tb" text-anchor="start">${esc(sheetName)} · Masse in mm</text>`,
    `<text x="${tbX + 69}" y="${tbY + 21.5}" class="tb" text-anchor="start">SchreinerCAD · ${date} · Blatt ${sheetNo}/2</text>`,
  ].join('');
}

/** Blatt 1: Ansichten + Ballons + Bemassung + Stücklisten-Block */
function buildViewsSheet(assembly: Assembly, params: CabinetParams): string {
  const { width: W, height: H } = assembly.overall;
  const Dtot = assembly.overall.depth;
  const parts = assembly.parts.filter((p) => p.groupKey !== 'Holzdübel');
  const cutRows = buildCutlist(assembly);

  const bomW = 118;
  const areaW = SHEET_W - 2 * MARGIN - bomW - 16;
  const areaH = SHEET_H - 2 * MARGIN - 10;
  const scale =
    SCALES.find((s) => (W + Dtot) / s + GAP + 24 <= areaW && (H + Dtot) / s + GAP + 18 <= areaH) ?? 20;
  const k = 1 / scale;

  const out: string[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number, cls: string) =>
    out.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" class="${cls}"/>`);
  const text = (x: number, y: number, s: string, cls: string, anchor = 'middle') =>
    out.push(`<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" class="${cls}" text-anchor="${anchor}">${esc(s)}</text>`);

  // Positionsnummern je Gruppe (aus der Stückliste)
  const posByGroup = new Map<string, number>();
  for (const row of cutRows) if (!posByGroup.has(row.name)) posByGroup.set(row.name, row.pos);

  function drawView(
    rects: Rect[],
    ox: number,
    oy: number,
    modelMinX: number,
    modelMaxY: number,
    label: string,
    dashedGroups: string[],
    withBalloons: boolean,
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
    for (const r of rects) {
      if (!dashedGroups.includes(r.part.groupKey)) continue;
      const px = ox + (r.x - modelMinX) * k;
      const py = oy + (modelMaxY - (r.y + r.h)) * k;
      out.push(
        `<rect x="${px.toFixed(2)}" y="${py.toFixed(2)}" width="${(r.w * k).toFixed(2)}" height="${(r.h * k).toFixed(2)}" class="hidden-edge"/>`,
      );
    }
    if (withBalloons) {
      const seen = new Set<number>();
      for (const r of [...rects].reverse()) {
        const pos = posByGroup.get(r.part.groupKey);
        if (!pos || seen.has(pos)) continue;
        seen.add(pos);
        const cx = ox + (r.x + r.w / 2 - modelMinX) * k;
        const cy = oy + (modelMaxY - (r.y + r.h / 2)) * k;
        out.push(`<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="3" class="balloon"/>`);
        out.push(`<text x="${cx.toFixed(2)}" y="${(cy + 1.1).toFixed(2)}" class="balloon-text" text-anchor="middle">${pos}</text>`);
      }
    }
    text(ox, maxPy + 5.2, label, 'view-label', 'start');
  }

  function dim(x1: number, y1: number, x2: number, y2: number, value: number, extA: [number, number], extB: [number, number]): void {
    line(extA[0], extA[1], x1, y1, 'ext');
    line(extB[0], extB[1], x2, y2, 'ext');
    out.push(
      `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" class="dim" marker-start="url(#arr)" marker-end="url(#arr)"/>`,
    );
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    if (Math.abs(x2 - x1) < Math.abs(y2 - y1)) {
      out.push(`<text x="${(mx - 1.6).toFixed(2)}" y="${my.toFixed(2)}" class="dim-text" text-anchor="middle" transform="rotate(-90 ${(mx - 1.6).toFixed(2)} ${my.toFixed(2)})">${value}</text>`);
    } else {
      text(mx, my - 1.6, String(value), 'dim-text');
    }
  }

  const frontW = W * k;
  const frontH = H * k;
  const depthW = Dtot * k;
  const ox1 = MARGIN + 14;
  const oy1 = MARGIN + 14;
  const ox2 = ox1 + frontW + GAP;
  const oy3 = oy1 + frontH + GAP;
  const dashed = ['Einlegeboden'];

  drawView(project(parts, 0, 1, 2), ox1, oy1, -W / 2, H / 2, 'Vorderansicht', dashed, true);
  const sideParts = project(parts, 2, 1, 0).map((r) => ({ ...r, x: -(r.x + r.w) }));
  const sideMinX = Math.min(...sideParts.map((r) => r.x));
  drawView(sideParts, ox2, oy1, sideMinX, H / 2, 'Seitenansicht von rechts', dashed, false);
  const topParts = project(parts, 0, 2, 1).map((r) => ({ ...r, y: -(r.y + r.h) }));
  const topMinY = Math.min(...topParts.map((r) => r.y));
  drawView(topParts, ox1, oy3, -W / 2, topMinY + Dtot, 'Draufsicht', [], false);

  dim(ox1, oy1 - 6, ox1 + frontW, oy1 - 6, W, [ox1, oy1], [ox1 + frontW, oy1]);
  dim(ox1 - 6, oy1, ox1 - 6, oy1 + frontH, H, [ox1, oy1], [ox1, oy1 + frontH]);
  dim(ox2, oy1 - 6, ox2 + depthW, oy1 - 6, Dtot, [ox2, oy1], [ox2 + depthW, oy1]);

  // --- Stücklisten-Block rechts -----------------------------------------------
  const bomX = SHEET_W - MARGIN - bomW;
  const rowH = 4.6;
  const bomH = (cutRows.length + 1) * rowH + 8;
  const bomY = MARGIN + 4;
  out.push(`<rect x="${bomX}" y="${bomY}" width="${bomW}" height="${bomH.toFixed(1)}" class="frame"/>`);
  text(bomX + 2, bomY + 4.4, 'Stückliste', 'view-label', 'start');
  const cols = [2, 9, 52, 60, 92]; // Pos, Bezeichnung, Stk, Masse, Material
  const heads = ['Pos', 'Bezeichnung', 'Stk', 'Masse (mm)', 'Material'];
  heads.forEach((label, i) => text(bomX + cols[i], bomY + 9.4, label, 'bom-head', 'start'));
  out.push(`<line x1="${bomX}" y1="${bomY + 10.8}" x2="${bomX + bomW}" y2="${bomY + 10.8}" class="frame"/>`);
  cutRows.forEach((row, i) => {
    const y = bomY + 10.8 + (i + 1) * rowH - 1.2;
    const material = row.material.length > 26 ? row.material.slice(0, 25) + '…' : row.material;
    const name = row.name.length > 20 ? row.name.slice(0, 19) + '…' : row.name;
    text(bomX + cols[0], y, String(row.pos), 'bom', 'start');
    text(bomX + cols[1], y, name, 'bom', 'start');
    text(bomX + cols[2], y, String(row.count), 'bom', 'start');
    text(bomX + cols[3], y, row.dims, 'bom', 'start');
    text(bomX + cols[4], y, material, 'bom', 'start');
  });
  text(bomX, bomY + bomH + 4, `Massstab 1:${scale}`, 'tb', 'start');

  return sheetShell(out.join('\n') + titleBlock(assembly, params, 1, `Ansichten · Massstab 1:${scale}`));
}

/** Blatt 2: Montagefolge — je Stufe eine Teilansicht, neue Teile markiert */
function buildStepsSheet(assembly: Assembly, params: CabinetParams): string {
  const { width: W, height: H } = assembly.overall;
  const parts = assembly.parts;
  const steps = assembly.stepCount;

  const cols = Math.min(4, steps);
  const rows = Math.ceil(steps / cols);
  const cellW = (SHEET_W - 2 * MARGIN - 8) / cols;
  const cellH = (SHEET_H - 2 * MARGIN - 34) / rows;
  const out: string[] = [];

  for (let s = 1; s <= steps; s++) {
    const col = (s - 1) % cols;
    const row = Math.floor((s - 1) / cols);
    const cx = MARGIN + 4 + col * cellW;
    const cy = MARGIN + 6 + row * cellH;

    const visible = parts.filter((p) => p.step <= s);
    const rects = project(visible, 0, 1, 2);
    const k = Math.min((cellW - 10) / W, (cellH - 22) / H);
    const ox = cx + (cellW - W * k) / 2;
    const oy = cy + 10;

    for (const r of rects) {
      const px = ox + (r.x + W / 2) * k;
      const py = oy + (H / 2 - (r.y + r.h)) * k;
      const cls = r.part.step === s ? 'part-new' : 'part';
      out.push(
        `<rect x="${px.toFixed(2)}" y="${py.toFixed(2)}" width="${(r.w * k).toFixed(2)}" height="${(r.h * k).toFixed(2)}" class="${cls}"/>`,
      );
    }

    const newNames = [...new Set(parts.filter((p) => p.step === s).map((p) => p.groupKey))];
    const shown = newNames.slice(0, 3).join(', ') + (newNames.length > 3 ? ` +${newNames.length - 3}` : '');
    out.push(
      `<text x="${(cx + 2).toFixed(1)}" y="${(cy + 5).toFixed(1)}" class="step-title" text-anchor="start">Stufe ${s}: ${esc(assembly.stepNames[s - 1] ?? '')}</text>`,
      `<text x="${(cx + 2).toFixed(1)}" y="${(cy + cellH - 4).toFixed(1)}" class="step-parts" text-anchor="start">+ ${esc(shown)}</text>`,
    );
  }

  out.push(
    `<text x="${MARGIN + 2}" y="${SHEET_H - MARGIN - 30}" class="view-label" text-anchor="start">Montagefolge — neue Teile je Stufe orange markiert (Frontansicht)</text>`,
  );
  return sheetShell(out.join('\n') + titleBlock(assembly, params, 2, 'Montagefolge'));
}

/** Kompletter Zeichnungssatz (Blatt 1 + Blatt 2) */
export function buildDrawingSheets(assembly: Assembly, params: CabinetParams): string[] {
  return [buildViewsSheet(assembly, params), buildStepsSheet(assembly, params)];
}

/** Beide Blätter als eine SVG-Datei (untereinander) für den Download */
export function buildDrawingBundleSvg(assembly: Assembly, params: CabinetParams): string {
  const [s1, s2] = buildDrawingSheets(assembly, params);
  const inner1 = s1.replace('<svg xmlns', `<svg y="0" width="${SHEET_W}" height="${SHEET_H}" xmlns`);
  const inner2 = s2.replace('<svg xmlns', `<svg y="${SHEET_H + 10}" width="${SHEET_W}" height="${SHEET_H}" xmlns`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SHEET_W} ${2 * SHEET_H + 10}">${inner1}${inner2}</svg>`;
}
