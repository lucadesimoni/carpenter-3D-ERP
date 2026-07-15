// Anwendung der Bearbeitungs-Overrides auf eine parametrische Baugruppe.
// Reihenfolge: unterdrücken → patchen (Name/Stufe/Versatz) → Kopien anfügen.

import type { Assembly, Overrides, PartSpec } from './types';

export function emptyOverrides(): Overrides {
  return { parts: {}, copies: [], stepNames: {}, additions: [] };
}

export function hasOverrides(o: Overrides): boolean {
  return (
    Object.keys(o.parts).length > 0 ||
    o.copies.length > 0 ||
    Object.keys(o.stepNames).length > 0 ||
    (o.additions ?? []).length > 0
  );
}

function shifted(pos: [number, number, number], off: [number, number, number]): [number, number, number] {
  return [pos[0] + off[0], pos[1] + off[1], pos[2] + off[2]];
}

export function applyOverrides(assembly: Assembly, o: Overrides, currentMaterial = 'eiche'): Assembly {
  // Katalog-Teile als reguläre Bauteile einreihen (letzte Montagestufe)
  const added: PartSpec[] = (o.additions ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    groupKey: a.name,
    shape: a.shape,
    size: [...a.size] as [number, number, number],
    axis: a.axis,
    position: [...a.position] as [number, number, number],
    materialKey: a.materialKey === 'current' ? currentMaterial : a.materialKey,
    grain: 'y' as const,
    explodeDir: [0, 0, 1] as [number, number, number],
    explodeScale: 1.8,
    step: assembly.stepCount,
    cut:
      a.shape === 'box'
        ? (() => {
            const sorted = [...a.size].sort((x, y) => x - y);
            return { thickness: sorted[0], width: sorted[1], length: sorted[2] };
          })()
        : undefined,
    cutNote: a.shape === 'cylinder' ? `ø${a.size[0]} × ${a.size[1]}` : undefined,
  }));

  const parts: PartSpec[] = [];
  for (const part of [...assembly.parts, ...added]) {
    const ov = o.parts[part.id];
    if (ov?.suppressed) continue;
    if (!ov) {
      parts.push(part);
      continue;
    }
    const p = structuredClone(part);
    if (ov.name) {
      p.name = ov.name;
      p.groupKey = ov.name; // eigene Stücklisten-Position
    }
    if (ov.step) p.step = Math.min(assembly.stepCount, Math.max(1, ov.step));
    if (ov.offset) p.position = shifted(p.position, ov.offset);
    if (ov.size && p.shape === 'box') {
      p.size = [...ov.size];
      if (p.cut) {
        // Zuschnittmasse aus den neuen Achsmassen ableiten (Stärke = kleinste,
        // Länge = grösste verbleibende — konsistent mit Bohrbild-Ableitung)
        const sorted = [...ov.size].sort((a, b) => a - b);
        p.cut = { thickness: sorted[0], width: sorted[1], length: sorted[2] };
      }
    }
    parts.push(p);
  }

  for (const copy of o.copies) {
    if (o.parts[copy.id]?.suppressed) continue; // Kopie selbst unterdrückt
    const src = parts.find((p) => p.id === copy.sourceId);
    if (!src) continue; // Quelle unterdrückt oder durch Parameter entfallen
    const c = structuredClone(src);
    c.id = copy.id;
    c.name = `${src.name} (Kopie)`;
    c.position = shifted(src.position, copy.offset);
    parts.push(c);
  }

  const stepNames = assembly.stepNames.map((n, i) => o.stepNames[i + 1] ?? n);
  return { ...assembly, parts, stepNames };
}
