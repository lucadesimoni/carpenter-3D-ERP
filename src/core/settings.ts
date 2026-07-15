// Anwendungs-Einstellungen (⚙): ERP-Anbindung, Katalog-Auto-Update und
// Fertigungsparameter — gebündelt ausserhalb der Haupt-UI, in localStorage.

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
