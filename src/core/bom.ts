// BOM (Bill of Materials): strukturierte Stückliste als JSON
// (Schema 'schreinercad-bom/1') für Export und ERP-Synchronisierung.

import { buildCutlist, totalArea } from './cutlist';
import { assemblySlug } from './furniture';
import type { Assembly, CabinetParams } from './types';

export interface BomItem {
  pos: number;
  name: string;
  qty: number;
  /** "L × B × S" in mm bzw. Freitext bei Zukaufteilen */
  dims: string;
  material: string;
  /** Nettofläche gesamt in m² (0 bei Zukaufteilen) */
  areaM2: number;
  kind: 'zuschnitt' | 'zukauf';
}

export interface Bom {
  schema: 'schreinercad-bom/1';
  /** Eindeutige Ereignis-ID (UUID) — Empfänger können damit deduplizieren */
  id: string;
  document: string;
  createdAt: string;
  params: {
    type: string;
    widthMm: number;
    heightMm: number;
    depthMm: number;
    thicknessMm: number;
    shelves: number;
    door: boolean;
    material: string;
  };
  overallMm: { width: number; height: number; depth: number };
  items: BomItem[];
  totals: { panelAreaM2: number; positions: number; pieces: number };
}

export function buildBom(assembly: Assembly, params: CabinetParams): Bom {
  const rows = buildCutlist(assembly);
  const items: BomItem[] = rows.map((r) => ({
    pos: r.pos,
    name: r.name,
    qty: r.count,
    dims: r.dims,
    material: r.material,
    areaM2: Number((r.area * r.count).toFixed(4)),
    kind: r.area > 0 ? 'zuschnitt' : 'zukauf',
  }));
  return {
    schema: 'schreinercad-bom/1',
    id: crypto.randomUUID(),
    document: `${assemblySlug(assembly)}-${params.width}x${params.height}x${params.depth}`,
    createdAt: new Date().toISOString(),
    params: {
      type: params.type,
      widthMm: params.width,
      heightMm: params.height,
      depthMm: params.depth,
      thicknessMm: params.thickness,
      shelves: params.shelves,
      door: params.door,
      material: params.materialKey,
    },
    overallMm: { ...assembly.overall },
    items,
    totals: {
      panelAreaM2: Number(totalArea(rows).toFixed(4)),
      positions: items.length,
      pieces: items.reduce((s, i) => s + i.qty, 0),
    },
  };
}

export interface SyncResult {
  ok: boolean;
  message: string;
}

/**
 * BOM an einen ERP-Endpunkt übertragen (HTTP POST, JSON).
 * Folgt gängiger Webhook-Praxis: eindeutige Ereignis-ID im Payload,
 * Idempotency-Key- und Schema-Versions-Header, optional Bearer-Token.
 */
export async function syncBom(bom: Bom, endpoint: string, apiKey?: string): Promise<SyncResult> {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': bom.id,
        'X-Schema-Version': bom.schema,
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(bom),
    });
    if (!res.ok) return { ok: false, message: `Endpunkt antwortete mit HTTP ${res.status}.` };
    return { ok: true, message: `BOM übertragen (${bom.totals.positions} Positionen).` };
  } catch (err) {
    return { ok: false, message: `Übertragung fehlgeschlagen: ${(err as Error).message}` };
  }
}
