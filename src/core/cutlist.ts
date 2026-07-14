// Stückliste (Zuschnittliste) aus der Baugruppe ableiten.

import { WOODS } from './wood';
import type { Assembly, PartSpec } from './types';

export interface CutlistRow {
  pos: number;
  name: string;
  count: number;
  /** "Länge × Breite × Stärke" bzw. Freitext bei Zukaufteilen */
  dims: string;
  material: string;
  /** Fläche in m² (0 bei Zukaufteilen) */
  area: number;
}

function materialLabel(part: PartSpec): string {
  if (part.vendor) return part.vendor;
  if (part.materialKey === 'metal') return 'Edelstahl';
  return WOODS[part.materialKey]?.label ?? part.materialKey;
}

export function buildCutlist(assembly: Assembly): CutlistRow[] {
  const groups = new Map<string, CutlistRow>();
  let pos = 0;
  for (const part of assembly.parts) {
    const dims = part.cut
      ? `${part.cut.length} × ${part.cut.width} × ${part.cut.thickness}`
      : part.cutNote ?? '—';
    const key = `${part.groupKey}|${dims}|${part.materialKey}`;
    const row = groups.get(key);
    if (row) {
      row.count++;
      continue;
    }
    pos++;
    groups.set(key, {
      pos,
      name: part.groupKey,
      count: 1,
      dims,
      material: materialLabel(part),
      area: part.cut ? (part.cut.length * part.cut.width) / 1e6 : 0,
    });
  }
  return [...groups.values()];
}

export function totalArea(rows: CutlistRow[]): number {
  return rows.reduce((sum, r) => sum + r.area * r.count, 0);
}

export function cutlistToCsv(rows: CutlistRow[]): string {
  const header = 'Pos;Bezeichnung;Anzahl;Masse (mm);Material;Flaeche gesamt (m2)';
  const lines = rows.map((r) =>
    [r.pos, r.name, r.count, r.dims, r.material, (r.area * r.count).toFixed(3)].join(';'),
  );
  return [header, ...lines].join('\n');
}
