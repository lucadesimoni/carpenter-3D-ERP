// Selbstoptimierende Montagereihenfolge: leitet aus Rolle (groupKey/Material)
// und Geometrie eine sinnvolle Bauabfolge ab und fasst sie zu Stufen zusammen.
// Reihenfolge (Schreiner-Praxis): Boden → Seiten → Deckel → Innenausbau →
// Rückwand → Fronten → Beschläge. Leere Phasen entfallen.

import type { Assembly, PartSpec } from './types';

const PHASE_NAMES = ['Boden', 'Seiten', 'Deckel', 'Innenausbau', 'Rückwand', 'Fronten', 'Beschläge'];

/** Phasenindex (0…6) eines Bauteils aus Rolle und Geometrie. */
function phaseOf(p: PartSpec, overall: Assembly['overall']): number {
  const gk = p.groupKey.toLowerCase();
  const [x, y, z] = p.position;

  if (p.materialKey === 'metal') return 6; // Beschläge zuletzt
  if (p.shape === 'cylinder') return 1; // Holzdübel/Verbinder mit dem Korpus

  // Rollen-Hinweise aus dem groupKey (parametrische Teile)
  if (/rückwand|rueckwand|ruckwand/.test(gk)) return 4;
  if (/tür|tuer|front|schub|auszug|blende/.test(gk)) return 5;
  if (/deckel|tischplatte|platte/.test(gk)) return 2;
  if (/korpusboden|sockel/.test(gk) || gk === 'boden') return 0;
  if (/seite|wange|tischbein|bein|zarge/.test(gk)) return 1;
  if (/einlege|regalboden|tablar/.test(gk)) return 3;

  // Geometrie-Fallback (z.B. Skizzenteile): dünnste Achse = Plattenorientierung
  if (p.shape === 'box') {
    const [sx, sy, sz] = p.size;
    const thin = sx <= sy && sx <= sz ? 0 : sy <= sz ? 1 : 2;
    if (thin === 1) {
      // waagrechte Platte: unten = Boden, oben = Deckel, dazwischen = Innenausbau
      const marginH = Math.min(90, overall.height * 0.15);
      if (y <= -overall.height / 2 + marginH) return 0;
      if (y >= overall.height / 2 - marginH) return 2;
      return 3;
    }
    if (thin === 2) return z < 0 ? 4 : 5; // hinten = Rückwand, vorne = Front
    // dünn in X → senkrechte Platte: aussen = Seite, sonst Innenwand
    const marginW = Math.min(70, overall.width * 0.12);
    return Math.abs(x) >= overall.width / 2 - marginW ? 1 : 3;
  }
  return 3;
}

export interface StepPlan {
  stepByPart: Record<string, number>;
  names: string[];
}

/** Optimierte Stufen-Zuordnung: nur belegte Phasen werden zu (nummerierten) Stufen. */
export function optimizeAssembly(parts: PartSpec[], overall: Assembly['overall']): StepPlan {
  const phaseByPart = new Map<string, number>();
  const used = new Set<number>();
  for (const p of parts) {
    const ph = phaseOf(p, overall);
    phaseByPart.set(p.id, ph);
    used.add(ph);
  }
  const phases = [...used].sort((a, b) => a - b);
  const stepOfPhase = new Map(phases.map((ph, i) => [ph, i + 1]));
  const stepByPart: Record<string, number> = {};
  for (const p of parts) stepByPart[p.id] = stepOfPhase.get(phaseByPart.get(p.id)!)!;
  return { stepByPart, names: phases.map((ph) => PHASE_NAMES[ph]) };
}
