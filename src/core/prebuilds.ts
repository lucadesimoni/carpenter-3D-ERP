// Vorlagen-Galerie: fertig parametrierte Entwürfe ("Prebuilds") für den
// Startdialog, inklusive Miniatur-Ansicht. Die Thumbnails werden aus dem
// echten parametrischen Modell erzeugt (Frontprojektion der Bauteile).

import { DEFAULT_PARAMS } from './cabinet';
import { buildFurniture } from './furniture';
import type { CabinetParams, FurnitureType } from './types';

export interface Prebuild {
  key: string;
  name: string;
  description: string;
  params: CabinetParams;
}

function p(overrides: Partial<CabinetParams>): CabinetParams {
  return structuredClone({ ...DEFAULT_PARAMS, ...overrides });
}

export const PREBUILDS: Prebuild[] = [
  {
    key: 'bad',
    name: 'Badschrank',
    description: 'Hängeschrank 400 × 600 × 250, 1 Boden, Tür',
    params: p({ type: 'haengeschrank', width: 400, height: 600, depth: 250, shelves: 1, door: true }),
  },
  {
    key: 'kueche',
    name: 'Küchen-Hängeschrank',
    description: 'Hängeschrank 800 × 600 × 320, 2 Böden, Tür',
    params: p({ type: 'haengeschrank', width: 800, height: 600, depth: 320, shelves: 2, door: true }),
  },
  {
    key: 'hochschrank',
    name: 'Hochschrank',
    description: 'Hängeschrank 600 × 1200 × 350, 3 Böden, Tür',
    params: p({ type: 'haengeschrank', width: 600, height: 1200, depth: 350, shelves: 3, door: true }),
  },
  {
    key: 'wandregal',
    name: 'Wandregal',
    description: 'Offener Hängekorpus 1200 × 900 × 300, 3 Böden',
    params: p({ type: 'haengeschrank', width: 1200, height: 900, depth: 300, shelves: 3, door: false }),
  },
  {
    key: 'kommode',
    name: 'Schubladenschrank',
    description: 'Kommoden-Korpus 800 × 800 × 400, Schubladen automatisch',
    params: p({ type: 'haengeschrank', width: 800, height: 800, depth: 400, shelves: 0, door: false, drawers: true }),
  },
  {
    key: 'esstisch',
    name: 'Esstisch',
    description: 'Esstisch 1800 × 750 × 900, Platte 25 mm',
    params: p({ type: 'tisch', width: 1800, height: 750, depth: 900, thickness: 25 }),
  },
  {
    key: 'schreibtisch',
    name: 'Schreibtisch',
    description: 'Tischgestell 1400 × 750 × 700, Platte 19 mm',
    params: p({ type: 'tisch', width: 1400, height: 750, depth: 700, thickness: 19 }),
  },
  {
    key: 'buecherregal',
    name: 'Bücherregal',
    description: 'Standregal 900 × 1800 × 300, 4 Böden',
    params: p({ type: 'regal', width: 900, height: 1800, depth: 300, shelves: 4 }),
  },
  {
    key: 'lowboard',
    name: 'Lowboard-Regal',
    description: 'Standregal 1600 × 500 × 400, 1 Boden',
    params: p({ type: 'regal', width: 1600, height: 500, depth: 400, shelves: 1 }),
  },
];

/** Leere Startpunkte je Möbeltyp (für «Neues Design») */
export const BLANK_STARTS: { type: FurnitureType; name: string; params: CabinetParams }[] = [
  { type: 'haengeschrank', name: 'Neuer Hängeschrank', params: p({ type: 'haengeschrank' }) },
  { type: 'tisch', name: 'Neuer Tisch', params: p({ type: 'tisch', width: 1600, height: 750, depth: 800, thickness: 25 }) },
  { type: 'regal', name: 'Neues Regal', params: p({ type: 'regal', width: 800, height: 1600, depth: 300, shelves: 3 }) },
];

/** Miniatur als Frontprojektion des echten Modells (SVG-String) */
export function prebuildThumbSvg(params: CabinetParams, w = 150, h = 110): string {
  const assembly = buildFurniture(params);
  const parts = assembly.parts.filter((part) => part.shape === 'box' || part.groupKey.includes('Griff'));
  const { width: W, height: H } = assembly.overall;
  const pad = 10;
  const k = Math.min((w - 2 * pad) / W, (h - 2 * pad) / H);
  const ox = (w - W * k) / 2;
  const oy = (h - H * k) / 2;

  // Painter-Reihenfolge: hinten zuerst
  const sorted = [...parts].sort((a, b) => a.position[2] - b.position[2]);
  const rects = sorted
    .map((part) => {
      const size =
        part.shape === 'cylinder'
          ? part.axis === 'y'
            ? [part.size[0], part.size[1], part.size[0]]
            : [part.size[0], part.size[0], part.size[1]]
          : part.size;
      const x = ox + (part.position[0] - size[0] / 2 + W / 2) * k;
      const y = oy + (H / 2 - part.position[1] - size[1] / 2) * k;
      const fill = part.materialKey === 'metal' ? '#9aa1a8' : part.materialKey === 'hdf' ? '#e8dbc0' : '#d9b98c';
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(size[0] * k).toFixed(1)}" height="${(size[1] * k).toFixed(1)}" fill="${fill}" stroke="#5c4a33" stroke-width="0.6"/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${rects}</svg>`;
}
