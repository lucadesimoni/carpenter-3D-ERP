// Beschläge-Bibliothek: vorkonfigurierte Systeme, wie sie im Möbelbau
// üblich sind (Topfscharniere, Bodenträger, Schrankaufhänger, Griffe).
// Die Herstellerangaben sind Beispiel-Referenzen ("z.B. Blum Clip top")
// für kompatible Standardsysteme — Bohrbilder folgen System 32.
//
// Scharniere und Griffe liegen in Registries, die durch importierte
// Herstellerkataloge (schreinercad-catalog/1) erweitert werden können.

import type { CabinetParams, CatalogItem, HardwareOptions, PartSpec, VendorCatalog } from './types';

export const DEFAULT_HARDWARE: HardwareOptions = {
  hinge: 'clip110',
  handle: 'bar',
  shelfPins: true,
  hangers: true,
};

export interface HingeDef {
  label: string;
  vendor: string;
  cupDiameter: number;
  /** Herstellername des Quellkatalogs (nur importierte Einträge) */
  fromCatalog?: string;
}

export interface HandleDef {
  label: string;
  vendor: string;
  style: 'bar' | 'knob';
  diameter: number;
  length: number;
  fromCatalog?: string;
}

const BUILTIN_HINGES: Record<string, HingeDef> = {
  clip110: { label: 'Topfscharnier 110°', vendor: 'z.B. Blum Clip top 110°', cupDiameter: 35 },
  wide155: { label: 'Weitwinkelscharnier 155°', vendor: 'z.B. Blum Clip top 155°', cupDiameter: 35 },
};

const BUILTIN_HANDLES: Record<string, HandleDef> = {
  bar: { label: 'Griffstange ø12 × 160', vendor: 'z.B. Häfele H1525, Edelstahl', style: 'bar', diameter: 12, length: 160 },
  knob: { label: 'Möbelknopf ø30', vendor: 'z.B. Häfele H2135, Edelstahl', style: 'knob', diameter: 30, length: 26 },
};

const hingeRegistry = new Map<string, HingeDef>(Object.entries(BUILTIN_HINGES));
const handleRegistry = new Map<string, HandleDef>(Object.entries(BUILTIN_HANDLES));

export const SHELF_PIN = { label: 'Bodenträger ø5', vendor: 'z.B. Häfele Safety' };
export const HANGER = { label: 'Schrankaufhänger', vendor: 'z.B. Camar 807, verstellbar' };

/** Registry-Schlüssel eines Katalog-Eintrags (Hersteller-Namespace) */
export function catalogItemKey(vendor: string, item: CatalogItem): string {
  return `${vendor}:${item.key}`;
}

/** Katalog in die Registries übernehmen (idempotent je Schlüssel). */
export function registerCatalog(catalog: VendorCatalog): void {
  for (const item of catalog.items) {
    const key = catalogItemKey(catalog.vendor, item);
    if (item.kind === 'hinge') {
      hingeRegistry.set(key, {
        label: item.label,
        vendor: item.vendor,
        cupDiameter: item.cupDiameter ?? 35,
        fromCatalog: catalog.vendor,
      });
    } else {
      handleRegistry.set(key, {
        label: item.label,
        vendor: item.vendor,
        style: item.style,
        diameter: item.diameter,
        length: item.length ?? (item.style === 'knob' ? 26 : 160),
        fromCatalog: catalog.vendor,
      });
    }
  }
}

/** Alle Einträge eines Herstellers wieder entfernen. */
export function unregisterCatalog(vendor: string): void {
  for (const [key, def] of [...hingeRegistry]) {
    if (def.fromCatalog === vendor) hingeRegistry.delete(key);
  }
  for (const [key, def] of [...handleRegistry]) {
    if (def.fromCatalog === vendor) handleRegistry.delete(key);
  }
}

export function listHinges(): [string, HingeDef][] {
  return [...hingeRegistry];
}

export function listHandles(): [string, HandleDef][] {
  return [...handleRegistry];
}

/** Def mit Fallback auf den Standard, falls ein Katalog entfernt wurde. */
export function getHinge(key: string): HingeDef | null {
  if (key === 'none') return null;
  return hingeRegistry.get(key) ?? BUILTIN_HINGES.clip110;
}

export function getHandle(key: string): HandleDef | null {
  if (key === 'none') return null;
  return handleRegistry.get(key) ?? BUILTIN_HANDLES.bar;
}

/** Anzahl Topfscharniere nach Türhöhe (übliche Faustregel) */
export function hingeCount(doorHeight: number): number {
  if (doorHeight <= 900) return 2;
  if (doorHeight <= 1300) return 3;
  return 4;
}

interface Ctx {
  W: number;
  H: number;
  D: number;
  t: number;
  shelfYs: number[];
  shelfDepth: number;
}

/** Beschläge-Bauteile gemäss Auswahl erzeugen (Positionen in Korpus-Koordinaten). */
export function buildHardware(params: CabinetParams, ctx: Ctx): PartSpec[] {
  const { hardware, door } = params;
  const { W, H, D, t, shelfYs, shelfDepth } = ctx;
  const parts: PartSpec[] = [];
  const innerW = W - 2 * t;

  // --- Topfscharniere (nur mit Tür): Topf in der Tür, Montageplatte an der Seite
  const hinge = door ? getHinge(hardware.hinge) : null;
  if (hinge) {
    const doorH = H - 4;
    const n = hingeCount(doorH);
    const cup = hinge.cupDiameter;
    const cupX = -(W - 4) / 2 + 24; // Topfbohrung 24 mm von Türkante, Bandseite links
    for (let i = 0; i < n; i++) {
      const y = -doorH / 2 + 100 + ((doorH - 200) * i) / Math.max(1, n - 1);
      parts.push({
        id: `scharnier-topf-${i + 1}`,
        name: `${hinge.label} ${i + 1}`,
        groupKey: hinge.label,
        shape: 'cylinder',
        size: [cup, 12, cup],
        axis: 'z',
        position: [cupX, y, D / 2 + 3],
        materialKey: 'metal',
        grain: 'z',
        explodeDir: [0, 0, 1],
        explodeScale: 1.55,
        step: 7,
        cutNote: `Topf ø${cup}, Bohrabstand 24`,
        vendor: hinge.vendor,
      });
      parts.push({
        id: `scharnier-platte-${i + 1}`,
        name: `Montageplatte ${i + 1}`,
        groupKey: 'Scharnier-Montageplatte',
        shape: 'box',
        size: [12, 52, 62],
        position: [-innerW / 2 + 6, y, D / 2 - 45],
        materialKey: 'metal',
        grain: 'y',
        explodeDir: [0, 0, 1],
        explodeScale: 1.2,
        step: 7,
        cutNote: 'System 32',
        vendor: 'z.B. Blum Montageplatte 173L',
      });
    }
  }

  // --- Griff (nur mit Tür)
  const handle = door ? getHandle(hardware.handle) : null;
  if (handle) {
    const doorW = W - 4;
    const handleX = doorW / 2 - 45;
    if (handle.style === 'bar') {
      parts.push({
        id: 'griff',
        name: handle.label,
        groupKey: handle.label,
        shape: 'cylinder',
        size: [handle.diameter, handle.length, handle.diameter],
        axis: 'y',
        position: [handleX, 0, D / 2 + t + 6 + handle.diameter / 2],
        materialKey: 'metal',
        grain: 'y',
        explodeDir: [0, 0, 1],
        explodeScale: 2.1,
        step: 7,
        cutNote: `ø${handle.diameter} × ${handle.length}`,
        vendor: handle.vendor,
      });
    } else {
      parts.push({
        id: 'griff',
        name: handle.label,
        groupKey: handle.label,
        shape: 'cylinder',
        size: [handle.diameter, handle.length, handle.diameter],
        axis: 'z',
        position: [handleX, 0, D / 2 + t + handle.length / 2],
        materialKey: 'metal',
        grain: 'z',
        explodeDir: [0, 0, 1],
        explodeScale: 2.1,
        step: 7,
        cutNote: `ø${handle.diameter}`,
        vendor: handle.vendor,
      });
    }
  }

  // --- Bodenträger ø5: 4 Stück je Einlegeboden, System-32-Lochreihe
  if (hardware.shelfPins) {
    let nr = 0;
    for (const y of shelfYs) {
      for (const sideSign of [-1, 1] as const) {
        for (const zSign of [-1, 1] as const) {
          nr++;
          parts.push({
            id: `bodentraeger-${nr}`,
            name: `Bodenträger ${nr}`,
            groupKey: SHELF_PIN.label,
            shape: 'cylinder',
            size: [5, 18, 5],
            axis: 'x',
            position: [
              sideSign * innerW / 2,
              y - t / 2 - 2.5,
              zSign * (shelfDepth / 2 - 37) + (D - shelfDepth) / 2 - 5,
            ],
            materialKey: 'metal',
            grain: 'x',
            explodeDir: [0, 0, 1],
            explodeScale: 0.8,
            step: 6,
            cutNote: 'ø5, Reihe System 32',
            vendor: SHELF_PIN.vendor,
          });
        }
      }
    }
  }

  // --- Schrankaufhänger: 2 Stück oben hinten, hinter der Rückwand verstellbar
  if (hardware.hangers) {
    for (const [sign, label] of [[-1, 'links'], [1, 'rechts']] as const) {
      parts.push({
        id: `aufhaenger-${label}`,
        name: `Schrankaufhänger ${label}`,
        groupKey: HANGER.label,
        shape: 'box',
        size: [62, 48, 16],
        position: [sign * (innerW / 2 - 40), H / 2 - t - 26, -D / 2 + 22],
        materialKey: 'metal',
        grain: 'y',
        explodeDir: [0, sign * 0.15, -1],
        explodeScale: 0.9,
        step: 5,
        cutNote: 'Tragkraft 130 kg/Paar',
        vendor: HANGER.vendor,
      });
    }
  }

  return parts;
}
