// Projektverwaltung mit Versionierung: jedes Speichern unter demselben
// Namen erzeugt eine neue Version (v1, v2, …), ältere Stände bleiben
// ladbar. Persistenz in localStorage, Sicherung als JSON-Datei.
// Schema 'schreinercad-project/2' (migriert automatisch von /1).

import type { CabinetParams, Overrides } from './types';

const STORAGE_KEY = 'schreinercad.projects.v2';
const LEGACY_KEY = 'schreinercad.projects.v1';

export interface ProjectVersion {
  version: number;
  savedAt: string;
  params: CabinetParams;
  /** Interaktive Bearbeitungen (optional, ab Schema-Erweiterung) */
  overrides?: Overrides;
}

export interface Project {
  schema: 'schreinercad-project/2';
  id: string;
  name: string;
  versions: ProjectVersion[];
}

function migrateLegacy(): Project[] {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return [];
    const legacy = JSON.parse(raw) as { id: string; name: string; savedAt: string; params: CabinetParams }[];
    localStorage.removeItem(LEGACY_KEY);
    return legacy.map((p) => ({
      schema: 'schreinercad-project/2' as const,
      id: p.id,
      name: p.name,
      versions: [{ version: 1, savedAt: p.savedAt, params: p.params }],
    }));
  } catch {
    return [];
  }
}

export function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const migrated = migrateLegacy();
      if (migrated.length) persist(migrated);
      return migrated;
    }
    const list = JSON.parse(raw) as Project[];
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

/** Neue Version unter dem Namen anlegen; liefert die gespeicherte Version. */
export function saveVersion(
  name: string,
  params: CabinetParams,
  overrides?: Overrides,
): { project: Project; version: number } {
  const list = loadProjects();
  let project = list.find((p) => p.name === name);
  if (!project) {
    project = { schema: 'schreinercad-project/2', id: crypto.randomUUID(), name, versions: [] };
    list.unshift(project);
  } else {
    // zuletzt gespeichertes Projekt nach oben
    list.splice(list.indexOf(project), 1);
    list.unshift(project);
  }
  const version = (project.versions.at(-1)?.version ?? 0) + 1;
  project.versions.push({
    version,
    savedAt: new Date().toISOString(),
    params: structuredClone(params),
    overrides: overrides ? structuredClone(overrides) : undefined,
  });
  persist(list);
  return { project, version };
}

export function deleteProject(id: string): Project[] {
  const list = loadProjects().filter((p) => p.id !== id);
  persist(list);
  return list;
}

export function latestVersion(project: Project): ProjectVersion {
  return project.versions[project.versions.length - 1];
}

export function exportProjects(): string {
  return JSON.stringify({ schema: 'schreinercad-projects/2', projects: loadProjects() }, null, 2);
}

/** Projekte aus Datei einlesen (gleiche Namen werden ersetzt, /1 wird migriert). */
export function importProjects(json: string): Project[] {
  const data = JSON.parse(json) as { schema?: string; projects?: unknown[] };
  let incoming: Project[];
  if (data.schema === 'schreinercad-projects/2' && Array.isArray(data.projects)) {
    incoming = (data.projects as Project[]).filter(
      (p) => p && typeof p.name === 'string' && Array.isArray(p.versions) && p.versions.length > 0,
    );
  } else if (data.schema === 'schreinercad-projects/1' && Array.isArray(data.projects)) {
    incoming = (data.projects as { id: string; name: string; savedAt: string; params: CabinetParams }[])
      .filter((p) => p && typeof p.name === 'string' && p.params)
      .map((p) => ({
        schema: 'schreinercad-project/2' as const,
        id: p.id ?? crypto.randomUUID(),
        name: p.name,
        versions: [{ version: 1, savedAt: p.savedAt, params: p.params }],
      }));
  } else {
    throw new Error("Datei ist kein Projekt-Export (Schema 'schreinercad-projects/1' oder '/2').");
  }
  const names = new Set(incoming.map((p) => p.name));
  const merged = [...incoming, ...loadProjects().filter((p) => !names.has(p.name))];
  persist(merged);
  return merged;
}
