// Beispiel-Baugruppe: parametrischer Hängeschrank (Korpus mit Dübelverbindung).
//
// Konstruktion:
//  - Seiten laufen durch (Höhe = Aussenhöhe), Boden/Deckel dazwischen, gedübelt ø8×40
//  - Rückwand 8 mm HDF, eingenutet (im Modell 12 mm nach innen versetzt dargestellt)
//  - Einlegeböden mit 1 mm Luft je Seite, 5 mm hinter Vorderkante zurückgesetzt
//  - Optional aufschlagende Tür mit Griffstange
//
// Koordinaten: x = Breite, y = Höhe, z = Tiefe. Ursprung = Korpusmitte. Masse in mm.

import { buildHardware, DEFAULT_HARDWARE } from './hardware';
import type { Assembly, CabinetParams, PartSpec } from './types';

const BACK_T = 8; // Rückwandstärke
const BACK_RECESS = 12; // Nut-Abstand von Hinterkante
const DOWEL_D = 8;
const DOWEL_L = 40;

export const DEFAULT_PARAMS: CabinetParams = {
  width: 800,
  height: 600,
  depth: 320,
  thickness: 18,
  shelves: 2,
  door: true,
  materialKey: 'eiche',
  hardware: { ...DEFAULT_HARDWARE },
};

export const PARAM_LIMITS = {
  width: { min: 300, max: 1600 },
  height: { min: 300, max: 1400 },
  depth: { min: 150, max: 600 },
  shelves: { min: 0, max: 5 },
} as const;

export function clampParams(p: CabinetParams): CabinetParams {
  const c = (v: number, lim: { min: number; max: number }) =>
    Math.min(lim.max, Math.max(lim.min, Math.round(v)));
  return {
    ...p,
    width: c(p.width, PARAM_LIMITS.width),
    height: c(p.height, PARAM_LIMITS.height),
    depth: c(p.depth, PARAM_LIMITS.depth),
    shelves: c(p.shelves, PARAM_LIMITS.shelves),
  };
}

export function buildCabinet(params: CabinetParams): Assembly {
  const { width: W, height: H, depth: D, thickness: t, shelves, door, materialKey } = params;
  const parts: PartSpec[] = [];
  const innerW = W - 2 * t;

  // --- Korpusboden und -deckel (Stufe 1 und 4) -------------------------------
  parts.push({
    id: 'boden',
    name: 'Korpusboden',
    groupKey: 'Korpusboden',
    shape: 'box',
    size: [innerW, t, D],
    position: [0, -(H / 2 - t / 2), 0],
    materialKey,
    grain: 'x',
    explodeDir: [0, -1, 0],
    explodeScale: 0.9,
    step: 1,
    cut: { length: innerW, width: D, thickness: t },
  });
  parts.push({
    id: 'deckel',
    name: 'Korpusdeckel',
    groupKey: 'Korpusdeckel',
    shape: 'box',
    size: [innerW, t, D],
    position: [0, H / 2 - t / 2, 0],
    materialKey,
    grain: 'x',
    explodeDir: [0, 1, 0],
    explodeScale: 0.9,
    step: 4,
    cut: { length: innerW, width: D, thickness: t },
  });

  // --- Dübel ø8×40: je 3 pro Eckverbindung (Stufe 2) -------------------------
  // Achse in x, zur Hälfte im Boden/Deckel, zur Hälfte in der Seite.
  const dowelZ = [-D / 2 + 40, 0, D / 2 - 40];
  let dowelNr = 0;
  for (const sideSign of [-1, 1] as const) {
    for (const vertSign of [-1, 1] as const) {
      for (const z of dowelZ) {
        dowelNr++;
        parts.push({
          id: `duebel-${dowelNr}`,
          name: `Dübel ${dowelNr}`,
          groupKey: 'Holzdübel',
          shape: 'cylinder',
          size: [DOWEL_D, DOWEL_L, DOWEL_D],
          axis: 'x',
          position: [sideSign * innerW / 2, vertSign * (H / 2 - t / 2), z],
          materialKey: 'buche',
          grain: 'x',
          explodeDir: [0, vertSign, 0],
          explodeScale: 0.55,
          step: vertSign === -1 ? 2 : 4,
          cutNote: `ø${DOWEL_D} × ${DOWEL_L}`,
        });
      }
    }
  }

  // --- Seiten (Stufe 3) -------------------------------------------------------
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

  // --- Rückwand (Stufe 5) -----------------------------------------------------
  // Eingenutet: greift 6 mm in Seiten/Boden/Deckel ein.
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

  // --- Einlegeböden (Stufe 6) --------------------------------------------------
  const shelfW = innerW - 2; // 1 mm Luft je Seite
  const shelfD = D - BACK_RECESS - BACK_T - 5; // 5 mm hinter Vorderkante
  const innerH = H - 2 * t;
  const shelfYs: number[] = [];
  for (let i = 0; i < shelves; i++) {
    const y = -innerH / 2 + (innerH * (i + 1)) / (shelves + 1);
    shelfYs.push(y);
    parts.push({
      id: `einlegeboden-${i + 1}`,
      name: shelves > 1 ? `Einlegeboden ${i + 1}` : 'Einlegeboden',
      groupKey: 'Einlegeboden',
      shape: 'box',
      size: [shelfW, t, shelfD],
      position: [0, y, (D - shelfD) / 2 - 5],
      materialKey,
      grain: 'x',
      explodeDir: [0, 0, 1],
      explodeScale: 1 + i * 0.35,
      step: 6,
      cut: { length: shelfW, width: shelfD, thickness: t },
    });
  }

  // --- Tür (Stufe 7) -------------------------------------------------------------
  if (door) {
    const doorW = W - 4;
    const doorH = H - 4;
    parts.push({
      id: 'tuer',
      name: 'Tür (aufschlagend)',
      groupKey: 'Tür',
      shape: 'box',
      size: [doorW, doorH, t],
      position: [0, 0, D / 2 + t / 2],
      materialKey,
      grain: 'y',
      explodeDir: [0, 0, 1],
      explodeScale: 1.7,
      step: 7,
      cut: { length: doorH, width: doorW, thickness: t },
    });
  }

  // --- Beschläge aus der Bibliothek (Scharniere, Griff, Bodenträger, Aufhänger) ---
  parts.push(...buildHardware(params, { W, H, D, t, shelfYs, shelfDepth: shelfD }));

  return {
    parts,
    overall: { width: W, height: H, depth: D + (door ? t : 0) },
    stepCount: 7,
  };
}
