// Anwendungs-Einstellungen (⚙): ERP-Anbindung, Katalog-Auto-Update,
// Fertigungs-, Fang-, Material- und Ansichtsvorgaben — gebündelt ausserhalb
// der Haupt-UI, in localStorage.

export type ViewBackground = 'hell' | 'warm' | 'dunkel';

export interface AppSettings {
  erpEndpoint: string;
  erpApiKey: string;
  catalogAutoSync: boolean;
  /** Raster für Bewegen/Skizze in mm (0 = aus) */
  gridSnap: number;
  /** Kanten-/Flächenfang an anderen Bauteilen */
  snapToPart: boolean;
  sheetLength: number;
  sheetWidth: number;
  kerf: number;
  trim: number;
  // --- Vorgaben (neue Entwürfe / Bauteile)
  /** Vorgabe-Materialstärke für neue Bauteile (mm) */
  defaultThickness: number;
  /** Vorgabe-Material (Holz-Schlüssel) */
  defaultMaterial: string;
  // --- Kantenband (Kantenbekleidung, wie JoinerCAD «Überzugsmaterial»)
  edgeBanding: boolean;
  /** Kantenband-Stärke in mm (für Bedarfsberechnung) */
  edgeBandingThickness: number;
  // --- Ansicht
  /** Montage-Animation beim Laden automatisch abspielen */
  autoAssemble: boolean;
  /** Bodenraster in der 3D-Ansicht anzeigen */
  showGrid: boolean;
  /** Hintergrund-Stimmung der 3D-Ansicht */
  background: ViewBackground;
}

const STORAGE_KEY = 'schreinercad.settings.v1';

export const DEFAULT_SETTINGS: AppSettings = {
  erpEndpoint: '',
  erpApiKey: '',
  catalogAutoSync: true,
  gridSnap: 5,
  snapToPart: true,
  sheetLength: 2800,
  sheetWidth: 2070,
  kerf: 4,
  trim: 10,
  defaultThickness: 18,
  defaultMaterial: 'eiche',
  edgeBanding: true,
  edgeBandingThickness: 1,
  autoAssemble: true,
  showGrid: true,
  background: 'hell',
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) } : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* optional */
  }
}
