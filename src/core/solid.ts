// Echter CSG-Kern im Browser: Manifold (WebAssembly). Ermöglicht boolesche
// Operationen – z.B. echte Durchgangsbohrungen, die aus dem Plattenkörper
// herausgeschnitten werden (nicht nur markiert). Der Kern wird einmalig
// asynchron geladen; danach laufen die Operationen synchron. Ohne geladenen
// Kern rendern Bauteile als einfache Körper (Fallback ohne Ausschnitt).

import type ModuleFactory from 'manifold-3d';
import type { BooleanOp, HoleFeature, PartSpec } from './types';

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

type MF = ReturnType<NonNullable<Toplevel>['Manifold']['cube']>;

/** Basiskörper: verrundeter Quader (echte Fase via Minkowski) oder scharfer Quader. */
function roundedBase(size: [number, number, number], fillet: number, scratch: MF[]): MF {
  const Man = wasm!.Manifold;
  if (fillet > 0) {
    const r = Math.min(fillet, Math.min(...size) / 2 - 0.5);
    if (r > 0.1) {
      const inner = Man.cube([size[0] - 2 * r, size[1] - 2 * r, size[2] - 2 * r], true);
      const ball = Man.sphere(r, 20);
      const rounded = inner.minkowskiSum(ball);
      scratch.push(inner, ball, rounded);
      return rounded;
    }
  }
  const c = Man.cube(size, true);
  scratch.push(c);
  return c;
}

/**
 * Zentrierter Quader mit echter Fase (Verrundung) und durchgehenden Bohrungen
 * als CSG. Liefert rohe Mesh-Daten (Position/Index) oder null ohne Kern.
 */
export function csgSolid(size: [number, number, number], holes: HoleFeature[], fillet = 0): RawMesh | null {
  if (!wasm) return null;
  const M = wasm.Manifold;
  const scratch: MF[] = [];
  let solid: MF = roundedBase(size, fillet, scratch);
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

// ---------------------------------------------- Boolesche Operationen (Body)

type AnyMF = MF;

/** Ein Bauteil (verrundeter Quader mit Bohrungen / Zylinder) als Manifold in Weltlage. */
function partToManifold(part: PartSpec): AnyMF | null {
  if (!wasm) return null;
  const M = wasm.Manifold;
  if (part.shape === 'box') {
    const scratch: AnyMF[] = [];
    let solid: AnyMF = roundedBase(part.size, part.chamfer ?? 0, scratch);
    for (const hole of part.holes ?? []) {
      const axisIdx = hole.axis === 'x' ? 0 : hole.axis === 'y' ? 1 : 2;
      let cyl: AnyMF = M.cylinder(part.size[axisIdx] + 4, hole.d / 2, hole.d / 2, 32, true);
      scratch.push(cyl);
      if (hole.axis === 'x') { const r = cyl.rotate([0, 90, 0]); scratch.push(r); cyl = r; }
      else if (hole.axis === 'y') { const r = cyl.rotate([90, 0, 0]); scratch.push(r); cyl = r; }
      const moved = cyl.translate(hole.pos);
      scratch.push(moved);
      const next = solid.subtract(moved);
      scratch.push(next);
      solid = next;
    }
    const world = solid.translate(part.position);
    for (const s of scratch) s.delete();
    return world;
  }
  if (part.shape === 'cylinder') {
    const [d, len] = [part.size[0], part.size[1]];
    let c: AnyMF = M.cylinder(len, d / 2, d / 2, 32, true);
    if (part.axis === 'x') { const r = c.rotate([0, 90, 0]); c.delete(); c = r; }
    else if (part.axis === 'y') { const r = c.rotate([90, 0, 0]); c.delete(); c = r; }
    const world = c.translate(part.position);
    c.delete();
    return world;
  }
  return null; // 'mesh' (bereits verrechnet) nicht erneut verknüpfbar
}

/**
 * Boolesche Operationen auf eine Bauteilliste anwenden (parametrisch, bei jedem
 * Aufbau neu berechnet). Ergebnis ersetzt beide Eingangsteile durch einen
 * CSG-Körper (shape 'mesh'). Fehlt der Kern, bleibt die Liste unverändert.
 */
export function applyBooleans(parts: PartSpec[], ops: BooleanOp[]): PartSpec[] {
  if (!wasm || ops.length === 0) return parts;
  let list = [...parts];
  for (const op of ops) {
    const a = list.find((p) => p.id === op.aId);
    const b = list.find((p) => p.id === op.bId);
    if (!a || !b) continue;
    const ma = partToManifold(a);
    const mb = partToManifold(b);
    if (!ma || !mb) { ma?.delete(); mb?.delete(); continue; }
    const res = op.op === 'union' ? ma.add(mb) : op.op === 'subtract' ? ma.subtract(mb) : ma.intersect(mb);
    const mesh = res.getMesh();
    ma.delete();
    mb.delete();
    res.delete();

    const np = mesh.numProp;
    const vp = mesh.vertProperties;
    const count = Math.floor(vp.length / np);
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < count; i++) {
      const x = vp[i * np], y = vp[i * np + 1], z = vp[i * np + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const center: [number, number, number] = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
    const size: [number, number, number] = [maxX - minX, maxY - minY, maxZ - minZ];
    const position = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      position[i * 3] = vp[i * np] - center[0];
      position[i * 3 + 1] = vp[i * np + 1] - center[1];
      position[i * 3 + 2] = vp[i * np + 2] - center[2];
    }
    const index = mesh.triVerts.slice();

    const symbol = op.op === 'union' ? '+' : op.op === 'subtract' ? '−' : '∩';
    const meshPart: PartSpec = {
      ...a,
      id: op.id,
      name: `${a.name} ${symbol} ${b.name}`,
      groupKey: 'CSG-Körper',
      shape: 'mesh',
      size,
      position: center,
      mesh: { position, index },
      cut: undefined,
      cutNote: `CSG-${op.op === 'union' ? 'Verbund' : op.op === 'subtract' ? 'Differenz' : 'Schnitt'}`,
      holes: undefined,
      chamfer: undefined,
      step: Math.min(a.step, b.step),
    };
    list = list.filter((p) => p.id !== a.id && p.id !== b.id);
    list.push(meshPart);
  }
  return list;
}
