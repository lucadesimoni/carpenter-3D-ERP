// Grundtypen des CAD-Datenmodells. Alle Masse in Millimetern.

export type GrainAxis = 'x' | 'y' | 'z';
export type PartShape = 'box' | 'cylinder';

export interface PartSpec {
  id: string;
  /** Anzeigename, z.B. "Seite links" */
  name: string;
  /** Gruppierungsschlüssel für die Stückliste (gleiche Teile werden gezählt) */
  groupKey: string;
  shape: PartShape;
  /** Aussenmasse x/y/z; bei 'cylinder': x = Durchmesser, y = Länge (Achse entlang `axis`) */
  size: [number, number, number];
  /** Zylinderachse (nur shape 'cylinder') */
  axis?: GrainAxis;
  /** Mittelpunkt in Baugruppen-Koordinaten (Ursprung = Korpusmitte) */
  position: [number, number, number];
  materialKey: string;
  /** Faser-/Laufrichtung des Furniers */
  grain: GrainAxis;
  /** Richtung (Einheitsvektor) für die Explosionsansicht */
  explodeDir: [number, number, number];
  /** Relative Explosionsweite (1 = Basisdistanz) */
  explodeScale: number;
  /** Montagereihenfolge: Teile mit gleicher Stufe bewegen sich gemeinsam */
  step: number;
  /** Zuschnittmasse für die Stückliste; ohne Angabe: Zukaufteil */
  cut?: { length: number; width: number; thickness: number };
  /** Freitext für Stückliste (z.B. "ø8 × 40") statt Zuschnittmassen */
  cutNote?: string;
  /** Herstellerhinweis für Zukaufteile, erscheint in der Stückliste */
  vendor?: string;
}

/**
 * Beschläge aus der Bibliothek. hinge/handle sind Registry-Schlüssel
 * ('none' = ohne); Herstellerkataloge können weitere Schlüssel beisteuern.
 */
export interface HardwareOptions {
  hinge: string;
  handle: string;
  shelfPins: boolean;
  hangers: boolean;
}

// ------------------------------------------------ Herstellerkataloge
// JSON-Schema 'schreinercad-catalog/1': importierbare Beschläge-Kataloge
// (Datei-Import oder URL-Sync), z.B. für Blum-/Häfele-Sortimente.

export interface CatalogHingeItem {
  kind: 'hinge';
  key: string;
  label: string;
  vendor: string;
  /** Topfdurchmesser in mm (Standard 35) */
  cupDiameter?: number;
}

export interface CatalogHandleItem {
  kind: 'handle';
  key: string;
  label: string;
  vendor: string;
  style: 'bar' | 'knob';
  diameter: number;
  /** Nur style 'bar': Grifflänge in mm */
  length?: number;
}

export type CatalogItem = CatalogHingeItem | CatalogHandleItem;

export interface VendorCatalog {
  schema: 'schreinercad-catalog/1';
  vendor: string;
  /** Optionaler Hinweis, z.B. Beispieldaten-Vermerk */
  note?: string;
  items: CatalogItem[];
}

/** Verfügbare Möbeltypen (je ein parametrischer Builder) */
export type FurnitureType = 'haengeschrank' | 'tisch' | 'regal';

export interface CabinetParams {
  type: FurnitureType;
  width: number;
  height: number;
  depth: number;
  thickness: number;
  shelves: number;
  door: boolean;
  materialKey: string;
  hardware: HardwareOptions;
}

export interface Assembly {
  /** Anzeigename, z.B. "Hängeschrank", "Esstisch" */
  name: string;
  /** Konstruktionshinweis fürs Titelblatt der Werkzeichnung */
  subtitle: string;
  parts: PartSpec[];
  overall: { width: number; height: number; depth: number };
  stepCount: number;
  /** Namen der Montagestufen (Länge = stepCount) */
  stepNames: string[];
}
