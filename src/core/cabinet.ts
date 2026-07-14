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
  type: 'haengeschrank',
  width: 800,
  height: 600,
  depth: 320,
  thickness: 18,
  shelves: 2,
  door: true,
  drawers: false,
  materialKey: 'eiche',
  hardware: { ...DEFAULT_HARDWARE },
};

export function buildCabinet(params: CabinetParams): Assembly {
  const { width: W, height: H, depth: D, thickness: t, materialKey, drawers } = params;
  const door = drawers ? false : params.door;
  const shelves = drawers ? 0 : params.shelves;
  const effective: CabinetParams = { ...params, door, shelves };
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

  // --- Schubladen: Front automatisch auf maximale Nutzhöhe aufgeteilt ------------
  let drawerCount = 0;
  if (drawers) {
    const frontH = H - 4;
    drawerCount = Math.min(5, Math.max(1, Math.round(frontH / 200)));
    const gap = 3;
    const fH = (frontH - gap * (drawerCount - 1)) / drawerCount;
    const slideClear = 12.5; // Platz je Seite für den Auszug
    const boxW = innerW - 2 * slideClear;
    const boxD = D - 30;
    const boxH = Math.min(150, fH - 30);
    const handle = buildHardware({ ...effective, door: true }, { W, H, D, t, shelfYs: [], shelfDepth: shelfD })
      .find((p) => p.id === 'griff');

    for (let i = 0; i < drawerCount; i++) {
      const yC = -frontH / 2 + fH / 2 + i * (fH + gap);
      const nr = drawerCount - i; // oberste = 1
      const ex = 1.2 + i * 0.25;
      // Front
      parts.push({
        id: `sk-front-${i}`,
        name: `Schubladenfront ${nr}`,
        groupKey: 'Schubladenfront',
        shape: 'box',
        size: [W - 4, fH, t],
        position: [0, yC, D / 2 + t / 2],
        materialKey,
        grain: 'y',
        explodeDir: [0, 0, 1],
        explodeScale: ex + 0.4,
        step: 7,
        cut: { length: fH, width: W - 4, thickness: t },
      });
      // Korpus der Schublade: Boden, 2 Zargen, Rücken
      parts.push({
        id: `sk-boden-${i}`,
        name: `Schubladenboden ${nr}`,
        groupKey: 'Schubladenboden',
        shape: 'box',
        size: [boxW, 8, boxD],
        position: [0, yC - boxH / 2 + 10, (D - boxD) / 2 - 8],
        materialKey: 'hdf',
        grain: 'x',
        explodeDir: [0, 0, 1],
        explodeScale: ex,
        step: 7,
        cut: { length: boxW, width: boxD, thickness: 8 },
      });
      for (const [sign, side] of [[-1, 'links'], [1, 'rechts']] as const) {
        parts.push({
          id: `sk-zarge-${i}-${side}`,
          name: `Schubladenzarge ${nr} ${side}`,
          groupKey: 'Schubladenzarge',
          shape: 'box',
          size: [15, boxH, boxD],
          position: [sign * (boxW / 2 - 7.5), yC + 10 - boxH / 2 + boxH / 2, (D - boxD) / 2 - 8],
          materialKey,
          grain: 'z',
          explodeDir: [0, 0, 1],
          explodeScale: ex,
          step: 7,
          cut: { length: boxD, width: boxH, thickness: 15 },
        });
        // Auszugschiene (Beschlag)
        parts.push({
          id: `sk-schiene-${i}-${side}`,
          name: `Auszug ${nr} ${side}`,
          groupKey: 'Vollauszug',
          shape: 'box',
          size: [12, 45, boxD],
          position: [sign * (innerW / 2 - 6), yC - boxH / 2 + 20, (D - boxD) / 2 - 8],
          materialKey: 'metal',
          grain: 'z',
          explodeDir: [0, 0, 1],
          explodeScale: ex - 0.3,
          step: 7,
          cutNote: `Nennlänge ${Math.round(boxD / 50) * 50}`,
          vendor: 'z.B. Blum Tandem Vollauszug',
        });
      }
      parts.push({
        id: `sk-ruecken-${i}`,
        name: `Schubladenrücken ${nr}`,
        groupKey: 'Schubladenrücken',
        shape: 'box',
        size: [boxW - 30, boxH, 15],
        position: [0, yC + 10, (D - boxD) / 2 - 8 - boxD / 2 + 7.5],
        materialKey,
        grain: 'x',
        explodeDir: [0, 0, 1],
        explodeScale: ex - 0.2,
        step: 7,
        cut: { length: boxW - 30, width: boxH, thickness: 15 },
      });
      // Griff je Front (aus der Beschläge-Registry, mittig)
      if (handle) {
        parts.push({
          ...structuredClone(handle),
          id: `sk-griff-${i}`,
          name: `${handle.name} (Front ${nr})`,
          position: [0, handle.grain === 'y' ? yC : yC, handle.position[2]],
          explodeScale: ex + 0.6,
        });
      }
    }
  }

  // --- Beschläge aus der Bibliothek (Scharniere, Griff, Bodenträger, Aufhänger) ---
  parts.push(...buildHardware(effective, { W, H, D, t, shelfYs, shelfDepth: shelfD }));

  return {
    name: drawers ? 'Schubladenschrank' : 'Hängeschrank',
    subtitle: drawers
      ? `Korpus gedübelt, ${drawerCount} Schubladen automatisch aufgeteilt, Vollauszüge`
      : `Korpus gedübelt, Rückwand HDF ${BACK_T} mm eingenutet`,
    parts,
    overall: { width: W, height: H, depth: D + (door ? t : 0) },
    stepCount: 7,
    stepNames: ['Boden', 'Dübel', 'Seiten', 'Deckel', 'Rückwand', 'Böden', 'Front'],
  };
}
