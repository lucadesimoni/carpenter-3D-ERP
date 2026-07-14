// Beschläge-Bibliothek: vorkonfigurierte Systeme, wie sie im Möbelbau
// üblich sind (Topfscharniere, Bodenträger, Schrankaufhänger, Griffe).
// Die Herstellerangaben sind Beispiel-Referenzen ("z.B. Blum Clip top")
// für kompatible Standardsysteme — Bohrbilder folgen System 32.

import type { CabinetParams, HardwareOptions, PartSpec } from './types';

export const DEFAULT_HARDWARE: HardwareOptions = {
  hinge: 'clip110',
  handle: 'bar',
  shelfPins: true,
  hangers: true,
};

export const HINGE_CATALOG = {
  clip110: { label: 'Topfscharnier 110°', vendor: 'z.B. Blum Clip top 110°' },
  wide155: { label: 'Weitwinkelscharnier 155°', vendor: 'z.B. Blum Clip top 155°' },
} as const;

export const HANDLE_CATALOG = {
  bar: { label: 'Griffstange ø12 × 160', vendor: 'z.B. Häfele H1525, Edelstahl' },
  knob: { label: 'Möbelknopf ø30', vendor: 'z.B. Häfele H2135, Edelstahl' },
} as const;

export const SHELF_PIN = { label: 'Bodenträger ø5', vendor: 'z.B. Häfele Safety' };
export const HANGER = { label: 'Schrankaufhänger', vendor: 'z.B. Camar 807, verstellbar' };

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

  // --- Topfscharniere (nur mit Tür): Topf ø35 in der Tür, Montageplatte an der Seite
  if (door && hardware.hinge !== 'none') {
    const cat = HINGE_CATALOG[hardware.hinge];
    const doorH = H - 4;
    const n = hingeCount(doorH);
    const cupX = -(W - 4) / 2 + 24; // Topfbohrung 24 mm von Türkante, Bandseite links
    for (let i = 0; i < n; i++) {
      const y = -doorH / 2 + 100 + ((doorH - 200) * i) / Math.max(1, n - 1);
      parts.push({
        id: `scharnier-topf-${i + 1}`,
        name: `${cat.label} ${i + 1}`,
        groupKey: cat.label,
        shape: 'cylinder',
        size: [35, 12, 35],
        axis: 'z',
        position: [cupX, y, D / 2 + 3],
        materialKey: 'metal',
        grain: 'z',
        explodeDir: [0, 0, 1],
        explodeScale: 1.55,
        step: 7,
        cutNote: 'Topf ø35, Bohrabstand 24',
        vendor: cat.vendor,
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
  if (door && hardware.handle !== 'none') {
    const doorW = W - 4;
    const handleX = doorW / 2 - 45;
    if (hardware.handle === 'bar') {
      parts.push({
        id: 'griff',
        name: 'Griffstange',
        groupKey: HANDLE_CATALOG.bar.label,
        shape: 'cylinder',
        size: [12, 160, 12],
        axis: 'y',
        position: [handleX, 0, D / 2 + t + 18],
        materialKey: 'metal',
        grain: 'y',
        explodeDir: [0, 0, 1],
        explodeScale: 2.1,
        step: 7,
        cutNote: 'ø12 × 160',
        vendor: HANDLE_CATALOG.bar.vendor,
      });
    } else {
      parts.push({
        id: 'griff',
        name: 'Möbelknopf',
        groupKey: HANDLE_CATALOG.knob.label,
        shape: 'cylinder',
        size: [30, 26, 30],
        axis: 'z',
        position: [handleX, 0, D / 2 + t + 13],
        materialKey: 'metal',
        grain: 'z',
        explodeDir: [0, 0, 1],
        explodeScale: 2.1,
        step: 7,
        cutNote: 'ø30',
        vendor: HANDLE_CATALOG.knob.vendor,
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
