// Bauteil-Katalog: einfache Zuschnitt-/Stangenteile, die per Klick oder
// Drag & Drop in das Modell eingefügt und dann frei bearbeitet werden
// (Grösse, Position, Name, Montagestufe — siehe Overrides).

import type { AddedPart } from './types';

export interface CatalogPart {
  key: string;
  name: string;
  description: string;
  shape: 'box' | 'cylinder';
  size: [number, number, number];
  axis?: 'x' | 'y' | 'z';
  /** 'current' = aktuelles Korpusmaterial */
  materialKey: string;
}

export const PARTS_CATALOG: CatalogPart[] = [
  { key: 'brett', name: 'Brett', description: '600 × 300 × 18', shape: 'box', size: [600, 18, 300], materialKey: 'current' },
  { key: 'platte', name: 'Platte gross', description: '800 × 600 × 18', shape: 'box', size: [800, 600, 18], materialKey: 'current' },
  { key: 'leiste', name: 'Leiste', description: '600 × 20 × 20', shape: 'box', size: [600, 20, 20], materialKey: 'buche' },
  { key: 'sockel', name: 'Sockelblende', description: '600 × 80 × 18', shape: 'box', size: [600, 80, 18], materialKey: 'current' },
  { key: 'rundstab', name: 'Rundstab ø20', description: 'ø20 × 600', shape: 'cylinder', size: [20, 600, 20], axis: 'x', materialKey: 'buche' },
  { key: 'strebe', name: 'Querstrebe', description: '500 × 60 × 22', shape: 'box', size: [500, 60, 22], materialKey: 'current' },
];

/** Einfüge-Instanz mit eindeutiger ID an gegebener Position erzeugen */
export function instantiateCatalogPart(
  part: CatalogPart,
  position: [number, number, number],
): AddedPart {
  return {
    id: `add-${crypto.randomUUID()}`,
    name: part.name,
    shape: part.shape,
    size: [...part.size],
    axis: part.axis,
    position,
    materialKey: part.materialKey,
  };
}
