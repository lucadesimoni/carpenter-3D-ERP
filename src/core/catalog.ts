// Herstellerkatalog-Verwaltung: Import (JSON-Datei), Synchronisierung
// von einer URL, Persistenz in localStorage und Registrierung in der
// Beschläge-Registry. Schema: 'schreinercad-catalog/1' (siehe types.ts).

import { registerCatalog, unregisterCatalog } from './hardware';
import type { CatalogItem, VendorCatalog } from './types';

const STORAGE_KEY = 'schreinercad.catalogs.v1';

export interface StoredCatalog {
  catalog: VendorCatalog;
  /** Quelle: 'datei' oder die Sync-URL */
  source: string;
  importedAt: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Wirft bei ungültigem Katalog einen Error mit verständlicher Meldung. */
export function validateCatalog(data: unknown): VendorCatalog {
  if (!isRecord(data)) throw new Error('Katalog ist kein JSON-Objekt.');
  if (data.schema !== 'schreinercad-catalog/1') {
    throw new Error("Feld 'schema' muss 'schreinercad-catalog/1' sein.");
  }
  if (typeof data.vendor !== 'string' || data.vendor.trim() === '') {
    throw new Error("Feld 'vendor' (Herstellername) fehlt.");
  }
  if (!Array.isArray(data.items) || data.items.length === 0) {
    throw new Error("Feld 'items' fehlt oder ist leer.");
  }
  const items: CatalogItem[] = [];
  for (const [i, raw] of data.items.entries()) {
    if (!isRecord(raw)) throw new Error(`Eintrag ${i + 1} ist kein Objekt.`);
    const { kind, key, label, vendor } = raw;
    if (kind !== 'hinge' && kind !== 'handle') {
      throw new Error(`Eintrag ${i + 1}: 'kind' muss 'hinge' oder 'handle' sein.`);
    }
    if (typeof key !== 'string' || typeof label !== 'string' || typeof vendor !== 'string') {
      throw new Error(`Eintrag ${i + 1}: 'key', 'label' und 'vendor' sind Pflichtfelder.`);
    }
    if (kind === 'hinge') {
      items.push({
        kind,
        key,
        label,
        vendor,
        cupDiameter: typeof raw.cupDiameter === 'number' ? raw.cupDiameter : undefined,
      });
    } else {
      if (raw.style !== 'bar' && raw.style !== 'knob') {
        throw new Error(`Eintrag ${i + 1}: Griff braucht 'style' ('bar' oder 'knob').`);
      }
      if (typeof raw.diameter !== 'number') {
        throw new Error(`Eintrag ${i + 1}: Griff braucht 'diameter' (mm).`);
      }
      items.push({
        kind,
        key,
        label,
        vendor,
        style: raw.style,
        diameter: raw.diameter,
        length: typeof raw.length === 'number' ? raw.length : undefined,
      });
    }
  }
  return {
    schema: 'schreinercad-catalog/1',
    vendor: data.vendor,
    note: typeof data.note === 'string' ? data.note : undefined,
    items,
  };
}

export function loadStoredCatalogs(): StoredCatalog[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as StoredCatalog[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function persist(list: StoredCatalog[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* Speichern optional (z.B. Private Mode) */
  }
}

/** Gespeicherte Kataloge beim Start in die Registry übernehmen. */
export function applyStoredCatalogs(): StoredCatalog[] {
  const list = loadStoredCatalogs();
  for (const entry of list) registerCatalog(entry.catalog);
  return list;
}

/** Katalog übernehmen (ersetzt einen vorhandenen gleichen Herstellers). */
export function addCatalog(catalog: VendorCatalog, source: string): StoredCatalog[] {
  unregisterCatalog(catalog.vendor);
  registerCatalog(catalog);
  const list = loadStoredCatalogs().filter((c) => c.catalog.vendor !== catalog.vendor);
  list.push({ catalog, source, importedAt: new Date().toISOString() });
  persist(list);
  return list;
}

export function removeCatalog(vendor: string): StoredCatalog[] {
  unregisterCatalog(vendor);
  const list = loadStoredCatalogs().filter((c) => c.catalog.vendor !== vendor);
  persist(list);
  return list;
}

/** Katalog von einer URL laden (JSON, gleiches Schema). */
export async function fetchCatalog(url: string): Promise<VendorCatalog> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} beim Laden von ${url}`);
  return validateCatalog(await res.json());
}
