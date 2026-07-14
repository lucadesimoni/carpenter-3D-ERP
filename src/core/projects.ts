// Projektverwaltung: benannte Entwürfe speichern/laden (localStorage)
// sowie als JSON-Datei sichern/einlesen — für den Betriebsalltag ohne
// Server-Backend. Schema 'schreinercad-project/1'.

import type { CabinetParams } from './types';

const STORAGE_KEY = 'schreinercad.projects.v1';

export interface Project {
  schema: 'schreinercad-project/1';
  id: string;
  name: string;
  savedAt: string;
  params: CabinetParams;
}

export function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? (JSON.parse(raw) as Project[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function persist(list: Project[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* Speichern optional (z.B. Private Mode) */
  }
}

/** Speichert unter dem Namen; gleicher Name überschreibt. */
export function saveProject(name: string, params: CabinetParams): Project[] {
  const list = loadProjects().filter((p) => p.name !== name);
  list.unshift({
    schema: 'schreinercad-project/1',
    id: crypto.randomUUID(),
    name,
    savedAt: new Date().toISOString(),
    params: structuredClone(params),
  });
  persist(list);
  return list;
}

export function deleteProject(id: string): Project[] {
  const list = loadProjects().filter((p) => p.id !== id);
  persist(list);
  return list;
}

export function exportProjects(): string {
  return JSON.stringify({ schema: 'schreinercad-projects/1', projects: loadProjects() }, null, 2);
}

/** Projekte aus Datei einlesen (ergänzt vorhandene; gleiche Namen werden ersetzt). */
export function importProjects(json: string): Project[] {
  const data = JSON.parse(json) as { schema?: string; projects?: Project[] };
  if (data.schema !== 'schreinercad-projects/1' || !Array.isArray(data.projects)) {
    throw new Error("Datei ist kein Projekt-Export (Schema 'schreinercad-projects/1').");
  }
  const incoming = data.projects.filter(
    (p) => p && typeof p.name === 'string' && p.params && typeof p.params.width === 'number',
  );
  const names = new Set(incoming.map((p) => p.name));
  const merged = [...incoming, ...loadProjects().filter((p) => !names.has(p.name))];
  persist(merged);
  return merged;
}
