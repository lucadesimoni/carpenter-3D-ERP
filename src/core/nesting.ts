// Zuschnittplan (Plattenaufteilung): einfache Streifen-Verschachtelung
// der Zuschnittteile auf Standard-Grossplatten, getrennt nach Material.
// Die Laufrichtung bleibt erhalten: Teillänge liegt immer entlang der
// Plattenlänge (2800er-Richtung). Ausgabe als SVG (Ansicht/Druck) und
// DXF (CNC/Weiterverarbeitung).

import { WOODS } from './wood';
import type { Assembly, PartSpec } from './types';

export interface NestingConfig {
  sheetLength: number;
  sheetWidth: number;
  kerf: number;
  trim: number;
}

export const DEFAULT_NESTING: NestingConfig = {
  sheetLength: 2800,
  sheetWidth: 2070,
  kerf: 4, // Sägeblatt
  trim: 10, // Besäumkante je Seite
};

export interface PlacedPart {
  name: string;
  x: number;
  y: number;
  length: number;
  width: number;
}

export interface Sheet {
  material: string;
  parts: PlacedPart[];
  /** Nettoflächen-Anteil 0…1 */
  utilization: number;
}

/** Streifen-Packung (Shelf-Packing): Teile nach Breite absteigend in Reihen. */
export function nestParts(assembly: Assembly, cfg: NestingConfig = DEFAULT_NESTING): Sheet[] {
  const { sheetLength: SHEET_LENGTH, sheetWidth: SHEET_WIDTH, kerf: KERF, trim: TRIM } = cfg;
  const byMaterial = new Map<string, PartSpec[]>();
  for (const part of assembly.parts) {
    if (!part.cut) continue;
    const list = byMaterial.get(part.materialKey) ?? [];
    list.push(part);
    byMaterial.set(part.materialKey, list);
  }

  const sheets: Sheet[] = [];
  const usableL = SHEET_LENGTH - 2 * TRIM;
  const usableW = SHEET_WIDTH - 2 * TRIM;

  for (const [materialKey, parts] of byMaterial) {
    const material = WOODS[materialKey]?.label ?? materialKey;
    const sorted = [...parts].sort((a, b) => b.cut!.width - a.cut!.width);

    let current: Sheet | null = null;
    let rowY = TRIM;
    let rowH = 0;
    let cursorX = TRIM;

    const openSheet = (): Sheet => {
      const sheet: Sheet = { material, parts: [], utilization: 0 };
      sheets.push(sheet);
      rowY = TRIM;
      rowH = 0;
      cursorX = TRIM;
      return sheet;
    };

    for (const part of sorted) {
      const L = part.cut!.length;
      const B = part.cut!.width;
      if (L > usableL || B > usableW) continue; // passt grundsätzlich nicht (kommt hier nicht vor)
      if (!current) current = openSheet();

      if (cursorX + L > TRIM + usableL) {
        // neue Reihe
        rowY += rowH + KERF;
        cursorX = TRIM;
        rowH = 0;
      }
      if (rowY + B > TRIM + usableW) {
        current = openSheet();
      }
      current.parts.push({ name: part.name, x: cursorX, y: rowY, length: L, width: B });
      cursorX += L + KERF;
      rowH = Math.max(rowH, B);
    }
  }

  for (const sheet of sheets) {
    const net = sheet.parts.reduce((s, p) => s + p.length * p.width, 0);
    sheet.utilization = net / (SHEET_LENGTH * SHEET_WIDTH);
  }
  return sheets;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildCutplanSvg(sheets: Sheet[], cfg: NestingConfig = DEFAULT_NESTING): string {
  const { sheetLength: SHEET_LENGTH, sheetWidth: SHEET_WIDTH } = cfg;
  const scale = 378 / SHEET_LENGTH;
  const pad = 14;
  const sheetH = SHEET_WIDTH * scale;
  const sheetW = SHEET_LENGTH * scale;
  const blockH = sheetH + 24;
  const totalH = pad + sheets.length * blockH + 4;
  const totalW = sheetW + 2 * pad;

  const out: string[] = [];
  sheets.forEach((sheet, i) => {
    const oy = pad + i * blockH;
    out.push(
      `<text x="${pad}" y="${oy - 3}" class="cap">Platte ${i + 1} — ${esc(sheet.material)} (${SHEET_LENGTH} × ${SHEET_WIDTH} mm) · Nutzung ${(sheet.utilization * 100).toFixed(0)} %</text>`,
      `<rect x="${pad}" y="${oy}" width="${sheetW.toFixed(1)}" height="${sheetH.toFixed(1)}" class="sheet"/>`,
    );
    for (const p of sheet.parts) {
      const x = pad + p.x * scale;
      const y = oy + p.y * scale;
      const w = p.length * scale;
      const h = p.width * scale;
      out.push(
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" class="piece"/>`,
        `<text x="${(x + w / 2).toFixed(1)}" y="${(y + h / 2 - 1).toFixed(1)}" class="piece-name" text-anchor="middle">${esc(p.name)}</text>`,
        `<text x="${(x + w / 2).toFixed(1)}" y="${(y + h / 2 + 4.5).toFixed(1)}" class="piece-dims" text-anchor="middle">${p.length} × ${p.width}</text>`,
      );
    }
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW.toFixed(0)} ${totalH.toFixed(0)}" font-family="'Segoe UI', sans-serif">
<style>
  .bg { fill: #ffffff; }
  .cap { font-size: 5px; fill: #1c2b4a; font-weight: 600; }
  .sheet { fill: #f2f0ea; stroke: #1c2b4a; stroke-width: 0.5; }
  .piece { fill: #e7d5b5; stroke: #4a3d28; stroke-width: 0.35; }
  .piece-name { font-size: 4px; fill: #2b2f33; }
  .piece-dims { font-size: 3.4px; fill: #6d6455; }
</style>
<rect width="${totalW.toFixed(0)}" height="${totalH.toFixed(0)}" class="bg"/>
${out.join('\n')}
</svg>`;
}

/** Minimal-DXF (ENTITIES-only, R12-kompatibel): Plattenkonturen, Teile, Beschriftung. */
export function buildCutplanDxf(sheets: Sheet[], cfg: NestingConfig = DEFAULT_NESTING): string {
  const { sheetLength: SHEET_LENGTH, sheetWidth: SHEET_WIDTH } = cfg;
  const e: string[] = [];
  const lineEnt = (x1: number, y1: number, x2: number, y2: number, layer: string) =>
    e.push('0', 'LINE', '8', layer, '10', x1.toFixed(1), '20', y1.toFixed(1), '11', x2.toFixed(1), '21', y2.toFixed(1));
  const rectEnt = (x: number, y: number, w: number, h: number, layer: string) => {
    lineEnt(x, y, x + w, y, layer);
    lineEnt(x + w, y, x + w, y + h, layer);
    lineEnt(x + w, y + h, x, y + h, layer);
    lineEnt(x, y + h, x, y, layer);
  };
  const textEnt = (x: number, y: number, height: number, value: string, layer: string) =>
    e.push('0', 'TEXT', '8', layer, '10', x.toFixed(1), '20', y.toFixed(1), '40', String(height), '1', value);

  sheets.forEach((sheet, i) => {
    const oy = i * (SHEET_WIDTH + 300); // Platten untereinander mit Abstand
    rectEnt(0, oy, SHEET_LENGTH, SHEET_WIDTH, 'PLATTE');
    textEnt(0, oy + SHEET_WIDTH + 60, 60, `Platte ${i + 1} - ${sheet.material}`, 'BESCHRIFTUNG');
    for (const p of sheet.parts) {
      // DXF-y wächst nach oben — Plan spiegeln, damit er wie im SVG liegt
      const y = oy + SHEET_WIDTH - p.y - p.width;
      rectEnt(p.x, y, p.length, p.width, 'TEILE');
      textEnt(p.x + 20, y + p.width / 2, 40, `${p.name} ${p.length}x${p.width}`, 'BESCHRIFTUNG');
    }
  });

  return ['0', 'SECTION', '2', 'ENTITIES', ...e, '0', 'ENDSEC', '0', 'EOF'].join('\r\n');
}
