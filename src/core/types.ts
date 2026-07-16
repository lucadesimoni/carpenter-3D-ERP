// Grundtypen des CAD-Datenmodells. Alle Masse in Millimetern.

export type GrainAxis = 'x' | 'y' | 'z';
export type PartShape = 'box' | 'cylinder' | 'mesh';

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
  /** Kantenbruch/Fase-Radius in mm (nur box) — gerundete Kanten in der 3D-Ansicht */
  chamfer?: number;
  /** Echte Bohrungen (CSG-Ausschnitte), Bauteil-lokale Koordinaten */
  holes?: HoleFeature[];
  /** Gebackene CSG-Geometrie (nur shape 'mesh'), zentriert um position */
  mesh?: { position: Float32Array; index: Uint32Array };
}

/** Bohrungs-Merkmal in Bauteil-lokalen Koordinaten (relativ zur Teilmitte). */
export interface HoleFeature {
  d: number;
  axis: GrainAxis;
  pos: [number, number, number];
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
  /** Front mit Schubladen füllen (Anzahl/Höhen automatisch optimiert) */
  drawers: boolean;
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

// ------------------------------------------------- Bearbeitungs-Overrides
// Interaktive Änderungen am parametrischen Modell (Browser/Zeitleiste):
// je Bauteil-ID Umbenennen, Stufe, Unterdrücken, Verschieben; dazu Kopien
// und Stufennamen. Overrides überleben Parameteränderungen (stabile IDs)
// und werden mit Projektversionen gespeichert.

export interface PartOverride {
  name?: string;
  step?: number;
  suppressed?: boolean;
  /** Verschiebung in mm relativ zur parametrischen Position */
  offset?: [number, number, number];
  /** Individuelle Bauteilmasse (x/y/z in mm), ersetzt die parametrischen */
  size?: [number, number, number];
  /** Kantenbruch/Fase-Radius in mm (0/undefined = scharfe Kante) */
  chamfer?: number;
  /** Echte Bohrungen (CSG), Bauteil-lokale Koordinaten */
  holes?: HoleFeature[];
}

export interface CopySpec {
  id: string;
  sourceId: string;
  offset: [number, number, number];
}

/** Aus dem Bauteil-Katalog eingefügtes Zusatzteil */
export interface AddedPart {
  id: string;
  name: string;
  shape: PartShape;
  size: [number, number, number];
  axis?: GrainAxis;
  position: [number, number, number];
  /** 'current' = aktuelles Korpusmaterial */
  materialKey: string;
}

/** Boolesche Verknüpfung zweier Bauteile (parametrisch, bei jedem Aufbau neu berechnet) */
export interface BooleanOp {
  id: string;
  op: 'union' | 'subtract' | 'intersect';
  aId: string;
  bId: string;
}

/**
 * Eingefügte (kombinierte) Baugruppe: ein Schnappschuss der Parameter und
 * Bearbeitungen einer anderen Baugruppe, positioniert relativ zum Korpus.
 * Wird bei jedem Aufbau frisch expandiert (bleibt also parametrisch änderbar).
 */
export interface InsertedAssembly {
  id: string;
  name: string;
  params: CabinetParams;
  overrides: Overrides;
  /** Versatz der eingefügten Baugruppe in Baugruppen-Koordinaten (mm) */
  offset: [number, number, number];
}

export interface Overrides {
  parts: Record<string, PartOverride>;
  copies: CopySpec[];
  /** Umbenannte Montagestufen (1-basiert) */
  stepNames: Record<number, string>;
  /** Eingefügte Katalog-Teile */
  additions?: AddedPart[];
  /** Zusätzliche, manuell angelegte Montagestufen (über die parametrischen hinaus) */
  extraSteps?: number;
  /** Explizite Stufenzahl (überschreibt Basis + extraSteps; für gebackene Optimierung) */
  stepCountOverride?: number;
  /** Montagereihenfolge automatisch aus der Geometrie optimieren (live) */
  optimize?: boolean;
  /** Boolesche Operationen (Vereinen/Subtrahieren/Schnittmenge) */
  booleans?: BooleanOp[];
  /** Eingefügte (kombinierte) andere Baugruppen */
  inserts?: InsertedAssembly[];
}
