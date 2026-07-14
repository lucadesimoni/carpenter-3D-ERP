// Möbeltypen-Dispatch: jeder Typ hat einen parametrischen Builder und
// eigene Parametergrenzen. Neue Möbel = neuer Builder + Eintrag hier.

import { buildCabinet } from './cabinet';
import { buildHardware } from './hardware';
import type { Assembly, CabinetParams, FurnitureType, PartSpec } from './types';

export interface TypeInfo {
  label: string;
  limits: {
    width: { min: number; max: number };
    height: { min: number; max: number };
    depth: { min: number; max: number };
    shelves: { min: number; max: number };
  };
  /** Welche Parameter/Beschläge dieser Typ nutzt */
  uses: { shelves: boolean; door: boolean; hardware: boolean };
}

export const FURNITURE_TYPES: Record<FurnitureType, TypeInfo> = {
  haengeschrank: {
    label: 'Hängeschrank',
    limits: {
      width: { min: 300, max: 1600 },
      height: { min: 300, max: 1400 },
      depth: { min: 150, max: 600 },
      shelves: { min: 0, max: 5 },
    },
    uses: { shelves: true, door: true, hardware: true },
  },
  tisch: {
    label: 'Esstisch',
    limits: {
      width: { min: 800, max: 2400 },
      height: { min: 550, max: 1100 },
      depth: { min: 500, max: 1100 },
      shelves: { min: 0, max: 0 },
    },
    uses: { shelves: false, door: false, hardware: false },
  },
  regal: {
    label: 'Standregal',
    limits: {
      width: { min: 300, max: 1600 },
      height: { min: 600, max: 2200 },
      depth: { min: 200, max: 500 },
      shelves: { min: 1, max: 6 },
    },
    uses: { shelves: true, door: false, hardware: false },
  },
};

export function clampParams(p: CabinetParams): CabinetParams {
  const limits = FURNITURE_TYPES[p.type].limits;
  const c = (v: number, lim: { min: number; max: number }) =>
    Math.min(lim.max, Math.max(lim.min, Math.round(v)));
  return {
    ...p,
    width: c(p.width, limits.width),
    height: c(p.height, limits.height),
    depth: c(p.depth, limits.depth),
    shelves: c(p.shelves, limits.shelves),
  };
}

export function buildFurniture(params: CabinetParams): Assembly {
  switch (params.type) {
    case 'tisch':
      return buildTable(params);
    case 'regal':
      return buildShelfUnit(params);
    default:
      return buildCabinet(params);
  }
}

// ------------------------------------------------------------------ Esstisch
// Vier Beine 70×70, umlaufende Zargen 22×100 (10 mm hinter Beinkante),
// gedübelte Zargen-Bein-Verbindung, aufliegende Platte.

const LEG = 70;
const LEG_INSET = 60; // Beinaussenkante von der Plattenkante
const APRON_T = 22;
const APRON_H = 100;

function buildTable(params: CabinetParams): Assembly {
  const { width: W, height: H, depth: D, thickness: tTop, materialKey } = params;
  const parts: PartSpec[] = [];
  const legH = H - tTop;
  const legCx = W / 2 - LEG_INSET - LEG / 2;
  const legCz = D / 2 - LEG_INSET - LEG / 2;

  for (const [sx, sz, label] of [
    [-1, -1, 'hinten links'],
    [1, -1, 'hinten rechts'],
    [-1, 1, 'vorne links'],
    [1, 1, 'vorne rechts'],
  ] as const) {
    parts.push({
      id: `bein-${label.replace(' ', '-')}`,
      name: `Tischbein ${label}`,
      groupKey: 'Tischbein',
      shape: 'box',
      size: [LEG, legH, LEG],
      position: [sx * legCx, -tTop / 2, sz * legCz],
      materialKey,
      grain: 'y',
      explodeDir: [sx * 0.35, -1, sz * 0.35],
      explodeScale: 0.9,
      step: 1,
      cut: { length: legH, width: LEG, thickness: LEG },
    });
  }

  // Dübel ø10×50: 2 je Zargen-Bein-Verbindung
  const apronY = H / 2 - tTop - APRON_H / 2;
  let dowelNr = 0;
  const dowelYs = [apronY + 25, apronY - 25];
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      for (const y of dowelYs) {
        // Verbindung Bein ↔ Längszarge (Achse x) und Bein ↔ Querzarge (Achse z)
        dowelNr++;
        parts.push({
          id: `tduebel-${dowelNr}`,
          name: `Dübel ${dowelNr}`,
          groupKey: 'Holzdübel',
          shape: 'cylinder',
          size: [10, 50, 10],
          axis: 'x',
          position: [sx * (legCx - LEG / 2), y, sz * legCz],
          materialKey: 'buche',
          grain: 'x',
          explodeDir: [sx, 0, 0],
          explodeScale: 0.5,
          step: 2,
          cutNote: 'ø10 × 50',
        });
        dowelNr++;
        parts.push({
          id: `tduebel-${dowelNr}`,
          name: `Dübel ${dowelNr}`,
          groupKey: 'Holzdübel',
          shape: 'cylinder',
          size: [10, 50, 10],
          axis: 'z',
          position: [sx * legCx, y, sz * (legCz - LEG / 2)],
          materialKey: 'buche',
          grain: 'z',
          explodeDir: [0, 0, sz],
          explodeScale: 0.5,
          step: 2,
          cutNote: 'ø10 × 50',
        });
      }
    }
  }

  // Zargen: aussen 10 mm hinter Beinkante
  const apronLenX = 2 * legCx - LEG; // zwischen den Bein-Innenkanten
  const apronLenZ = 2 * legCz - LEG;
  for (const [sz, label] of [[1, 'vorne'], [-1, 'hinten']] as const) {
    parts.push({
      id: `zarge-${label}`,
      name: `Zarge ${label}`,
      groupKey: 'Zarge lang',
      shape: 'box',
      size: [apronLenX, APRON_H, APRON_T],
      position: [0, apronY, sz * (legCz + LEG / 2 - 10 - APRON_T / 2)],
      materialKey,
      grain: 'x',
      explodeDir: [0, 0, sz],
      explodeScale: 1.1,
      step: 3,
      cut: { length: apronLenX, width: APRON_H, thickness: APRON_T },
    });
  }
  for (const [sx, label] of [[-1, 'links'], [1, 'rechts']] as const) {
    parts.push({
      id: `zarge-${label}`,
      name: `Zarge ${label}`,
      groupKey: 'Zarge kurz',
      shape: 'box',
      size: [APRON_T, APRON_H, apronLenZ],
      position: [sx * (legCx + LEG / 2 - 10 - APRON_T / 2), apronY, 0],
      materialKey,
      grain: 'z',
      explodeDir: [sx, 0, 0],
      explodeScale: 1.1,
      step: 3,
      cut: { length: apronLenZ, width: APRON_H, thickness: APRON_T },
    });
  }

  parts.push({
    id: 'platte',
    name: 'Tischplatte',
    groupKey: 'Tischplatte',
    shape: 'box',
    size: [W, tTop, D],
    position: [0, H / 2 - tTop / 2, 0],
    materialKey,
    grain: 'x',
    explodeDir: [0, 1, 0],
    explodeScale: 1.3,
    step: 4,
    cut: { length: W, width: D, thickness: tTop },
  });

  return {
    name: 'Esstisch',
    subtitle: `Beine ${LEG} × ${LEG}, Zargen ${APRON_T} × ${APRON_H}, gedübelt`,
    parts,
    overall: { width: W, height: H, depth: D },
    stepCount: 4,
    stepNames: ['Beine', 'Dübel', 'Zargen', 'Tischplatte'],
  };
}

// -------------------------------------------------------------- Standregal
// Durchlaufende Seiten, feste Böden (inkl. Ober-/Unterboden) gedübelt,
// eingenutete Rückwand.

const BACK_T = 8;
const BACK_RECESS = 12;

function buildShelfUnit(params: CabinetParams): Assembly {
  const { width: W, height: H, depth: D, thickness: t, shelves, materialKey } = params;
  const parts: PartSpec[] = [];
  const innerW = W - 2 * t;
  const boardCount = shelves + 2; // inkl. Ober- und Unterboden
  const boardYs: number[] = [];
  for (let i = 0; i < boardCount; i++) {
    boardYs.push(-(H / 2 - t / 2) + ((H - t) * i) / (boardCount - 1));
  }

  boardYs.forEach((y, i) => {
    const name = i === 0 ? 'Unterboden' : i === boardCount - 1 ? 'Oberboden' : `Regalboden ${i}`;
    parts.push({
      id: `boden-${i}`,
      name,
      groupKey: 'Regalboden',
      shape: 'box',
      size: [innerW, t, D],
      position: [0, y, 0],
      materialKey,
      grain: 'x',
      explodeDir: [0, i === 0 ? -1 : 1, 0],
      explodeScale: i === 0 ? 0.9 : 0.5 + i * 0.28,
      step: i === 0 ? 1 : 4,
      cut: { length: innerW, width: D, thickness: t },
    });

    // 2 Dübel ø8×40 je Seite und Boden
    for (const sign of [-1, 1] as const) {
      for (const z of [-D / 2 + 50, D / 2 - 50]) {
        parts.push({
          id: `rduebel-${i}-${sign}-${Math.round(z)}`,
          name: 'Dübel',
          groupKey: 'Holzdübel',
          shape: 'cylinder',
          size: [8, 40, 8],
          axis: 'x',
          position: [sign * innerW / 2, y, z],
          materialKey: 'buche',
          grain: 'x',
          explodeDir: [0, i === 0 ? -1 : 1, 0],
          explodeScale: (i === 0 ? 0.9 : 0.5 + i * 0.28) * 0.6,
          step: 2,
          cutNote: 'ø8 × 40',
        });
      }
    }
  });

  for (const [sign, label] of [[-1, 'links'], [1, 'rechts']] as const) {
    parts.push({
      id: `seite-${label}`,
      name: `Seite ${label}`,
      groupKey: 'Seite',
      shape: 'box',
      size: [t, H, D],
      position: [sign * (W / 2 - t / 2), 0, 0],
      materialKey,
      grain: 'y',
      explodeDir: [sign, 0, 0],
      explodeScale: 1,
      step: 3,
      cut: { length: H, width: D, thickness: t },
    });
  }

  const backW = innerW + 12;
  const backH = H - 2 * t + 12;
  parts.push({
    id: 'rueckwand',
    name: 'Rückwand',
    groupKey: 'Rückwand',
    shape: 'box',
    size: [backW, backH, BACK_T],
    position: [0, 0, -D / 2 + BACK_RECESS + BACK_T / 2],
    materialKey: 'hdf',
    grain: 'y',
    explodeDir: [0, 0, -1],
    explodeScale: 1.2,
    step: 5,
    cut: { length: backH, width: backW, thickness: BACK_T },
  });

  return {
    name: 'Standregal',
    subtitle: `${boardCount} feste Böden gedübelt, Rückwand HDF ${BACK_T} mm eingenutet`,
    parts,
    overall: { width: W, height: H, depth: D },
    stepCount: 5,
    stepNames: ['Unterboden', 'Dübel', 'Seiten', 'Böden', 'Rückwand'],
  };
}

/** Dateiname-tauglicher Slug des Möbelnamens */
export function assemblySlug(assembly: Assembly): string {
  return assembly.name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/[^a-z0-9]+/g, '-');
}

// Re-Export, damit buildHardware für künftige Typen zentral verfügbar bleibt
export { buildHardware };
