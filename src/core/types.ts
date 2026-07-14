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

/** Beschläge aus der Bibliothek (vorkonfigurierte Systeme) */
export interface HardwareOptions {
  hinge: 'clip110' | 'wide155' | 'none';
  handle: 'bar' | 'knob' | 'none';
  shelfPins: boolean;
  hangers: boolean;
}

export interface CabinetParams {
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
  parts: PartSpec[];
  overall: { width: number; height: number; depth: number };
  stepCount: number;
}
