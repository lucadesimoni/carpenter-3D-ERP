// Echter CSG-Kern im Browser: Manifold (WebAssembly). Ermöglicht boolesche
// Operationen – z.B. echte Durchgangsbohrungen, die aus dem Plattenkörper
// herausgeschnitten werden (nicht nur markiert). Der Kern wird einmalig
// asynchron geladen; danach laufen die Operationen synchron. Ohne geladenen
// Kern rendern Bauteile als einfache Körper (Fallback ohne Ausschnitt).

import type ModuleFactory from 'manifold-3d';
import type { HoleFeature } from './types';

// Nur Typen aus dem Kern (zur Laufzeit dynamisch geladen, siehe initSolid).
type Toplevel = Awaited<ReturnType<typeof ModuleFactory>>;
let wasm: Toplevel | null = null;
let loading: Promise<void> | null = null;

/**
 * Kern einmalig laden (idempotent, dynamischer Import → eigener Chunk).
 * Bricht still ab, wenn WASM nicht verfügbar ist (Fallback ohne Ausschnitt).
 */
export function initSolid(): Promise<void> {
  if (wasm) return Promise.resolve();
  if (!loading) {
    loading = (async () => {
      const [{ default: Module }, { default: wasmUrl }] = await Promise.all([
        import('manifold-3d'),
        import('manifold-3d/manifold.wasm?url'),
      ]);
      const mod = await Module({ locateFile: () => wasmUrl });
      mod.setup();
      wasm = mod;
    })().catch(() => {
      wasm = null;
    });
  }
  return loading;
}

export function isSolidReady(): boolean {
  return wasm !== null;
}

export interface RawMesh {
  position: Float32Array;
  index: Uint32Array;
}

/**
 * Quader (zentriert) mit durchgehenden Bohrungen als CSG-Differenz.
 * Liefert rohe Mesh-Daten (Position/Index) oder null, wenn der Kern fehlt.
 */
export function boxWithHoles(size: [number, number, number], holes: HoleFeature[]): RawMesh | null {
  if (!wasm) return null;
  const M = wasm.Manifold;
  type MF = ReturnType<typeof M.cube>;
  const scratch: MF[] = [];
  let solid: MF = M.cube(size, true);
  scratch.push(solid);
  for (const hole of holes) {
    const axisIdx = hole.axis === 'x' ? 0 : hole.axis === 'y' ? 1 : 2;
    const len = size[axisIdx] + 4;
    let cyl: MF = M.cylinder(len, hole.d / 2, hole.d / 2, 32, true);
    scratch.push(cyl);
    if (hole.axis === 'x') { const r = cyl.rotate([0, 90, 0]); scratch.push(r); cyl = r; }
    else if (hole.axis === 'y') { const r = cyl.rotate([90, 0, 0]); scratch.push(r); cyl = r; }
    const moved = cyl.translate(hole.pos);
    scratch.push(moved);
    const next = solid.subtract(moved);
    scratch.push(next);
    solid = next;
  }
  const mesh = solid.getMesh();
  const np = mesh.numProp;
  const vp = mesh.vertProperties;
  const count = Math.floor(vp.length / np);
  let position: Float32Array;
  if (np === 3) {
    position = vp.slice();
  } else {
    position = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      position[i * 3] = vp[i * np];
      position[i * 3 + 1] = vp[i * np + 1];
      position[i * 3 + 2] = vp[i * np + 2];
    }
  }
  const index = mesh.triVerts.slice();
  for (const s of scratch) s.delete();
  return { position, index };
}
