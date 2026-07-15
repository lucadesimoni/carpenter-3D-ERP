// Prozedurale Holz-Materialien (Canvas-Texturen, kein Asset-Download nötig).

import * as THREE from 'three';
import type { GrainAxis } from './types';

export interface WoodDef {
  key: string;
  label: string;
  base: string;
  grain: string;
  dark: string;
  plain?: boolean;
}

export const WOODS: Record<string, WoodDef> = {
  eiche: { key: 'eiche', label: 'Eiche furniert', base: '#c9a26b', grain: '#a97f47', dark: '#8a6537' },
  buche: { key: 'buche', label: 'Buche furniert', base: '#dcb48c', grain: '#c69f77', dark: '#a87f58' },
  nussbaum: { key: 'nussbaum', label: 'Nussbaum furniert', base: '#7d5a3c', grain: '#63452b', dark: '#4c3520' },
  fichte: { key: 'fichte', label: 'Fichte massiv', base: '#e6c795', grain: '#d0ab72', dark: '#b28d55' },
  mdf: { key: 'mdf', label: 'MDF weiss beschichtet', base: '#eceae4', grain: '#e2dfd7', dark: '#d6d2c8', plain: true },
  hdf: { key: 'hdf', label: 'HDF natur (Rückwand)', base: '#d2b389', grain: '#c2a37b', dark: '#ab8d64' },
};

/** Deterministischer Pseudozufall, damit Texturen bei jedem Rebuild gleich aussehen. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeWoodCanvas(def: WoodDef): HTMLCanvasElement {
  const w = 256;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const rnd = mulberry32([...def.key].reduce((s, c) => s + c.charCodeAt(0), 7));

  ctx.fillStyle = def.base;
  ctx.fillRect(0, 0, w, h);

  if (def.plain) {
    // Beschichtete Platte: nur feines Rauschen
    for (let i = 0; i < 2500; i++) {
      ctx.fillStyle = rnd() > 0.5 ? def.grain : def.dark;
      ctx.globalAlpha = 0.05 * rnd();
      ctx.fillRect(rnd() * w, rnd() * h, 1.2, 1.2);
    }
    ctx.globalAlpha = 1;
    return canvas;
  }

  // Breite, weiche Farbbänder (Jahrring-Zonen), Faser vertikal
  for (let x = 0; x < w; x++) {
    const band =
      Math.sin(x * 0.045 + Math.sin(x * 0.012) * 2.2) * 0.5 +
      Math.sin(x * 0.11 + 1.7) * 0.22;
    ctx.fillStyle = band > 0 ? def.grain : def.base;
    ctx.globalAlpha = Math.min(0.35, Math.abs(band) * 0.4);
    ctx.fillRect(x, 0, 1, h);
  }
  ctx.globalAlpha = 1;

  // Feine, leicht gewellte Faserlinien
  const lines = 46;
  for (let i = 0; i < lines; i++) {
    const x0 = rnd() * w;
    const amp = 2 + rnd() * 6;
    const freq = 0.008 + rnd() * 0.012;
    const phase = rnd() * Math.PI * 2;
    ctx.strokeStyle = rnd() > 0.35 ? def.grain : def.dark;
    ctx.globalAlpha = 0.08 + rnd() * 0.16;
    ctx.lineWidth = 0.6 + rnd() * 1.4;
    ctx.beginPath();
    for (let y = 0; y <= h; y += 8) {
      const x = x0 + Math.sin(y * freq + phase) * amp;
      if (y === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return canvas;
}

const textureCache = new Map<string, THREE.Texture>();

function getWoodTexture(key: string, rotated: boolean): THREE.Texture {
  const cacheKey = `${key}:${rotated ? 'h' : 'v'}`;
  let tex = textureCache.get(cacheKey);
  if (!tex) {
    const def = WOODS[key] ?? WOODS.eiche;
    tex = new THREE.CanvasTexture(makeWoodCanvas(def));
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    if (rotated) {
      tex.center.set(0.5, 0.5);
      tex.rotation = Math.PI / 2;
    }
    textureCache.set(cacheKey, tex);
  }
  return tex;
}

const materialCache = new Map<string, THREE.MeshStandardMaterial>();

/**
 * Material für ein Bauteil. Die Textur läuft standardmässig vertikal (y);
 * für Faserrichtung x/z wird sie um 90° gedreht.
 */
export function getWoodMaterial(key: string, grain: GrainAxis): THREE.MeshStandardMaterial {
  const rotated = grain !== 'y';
  const cacheKey = `${key}:${rotated ? 'h' : 'v'}`;
  let mat = materialCache.get(cacheKey);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      map: getWoodTexture(key, rotated),
      roughness: WOODS[key]?.plain ? 0.45 : 0.62,
      metalness: 0.0,
      envMapIntensity: 0.55,
    });
    materialCache.set(cacheKey, mat);
  }
  return mat;
}

/** Schlichtes Material für Beschläge (Griff etc.) */
export function getMetalMaterial(): THREE.MeshStandardMaterial {
  let mat = materialCache.get('metal:') as THREE.MeshStandardMaterial | undefined;
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      color: 0x8f939a,
      roughness: 0.35,
      metalness: 0.85,
      envMapIntensity: 1.0,
    });
    materialCache.set('metal:', mat);
  }
  return mat;
}

/** Dunkles, mattes Material für Bohrungen (Bohr-Referenz in der 3D-Ansicht). */
export function getBoreMaterial(): THREE.MeshStandardMaterial {
  let mat = materialCache.get('bore:') as THREE.MeshStandardMaterial | undefined;
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ color: 0x1a1d21, roughness: 0.95, metalness: 0.0 });
    materialCache.set('bore:', mat);
  }
  return mat;
}
