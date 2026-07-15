// UI-Verdrahtung: Parameter → Baugruppe → Viewer, Browser-Baum,
// Zeitleiste, Prüfwerkzeuge, Stückliste/BOM und Herstellerkataloge.

import './style.css';
import { buildBom, syncBom } from './core/bom';
import { DEFAULT_PARAMS } from './core/cabinet';
import { assemblySlug, buildFurniture, clampParams, FURNITURE_TYPES } from './core/furniture';
import {
  addCatalog,
  applyStoredCatalogs,
  autoSyncCatalogs,
  fetchCatalog,
  loadStoredCatalogs,
  removeCatalog,
  validateCatalog,
} from './core/catalog';
import { buildCutlist, cutlistToCsv, totalArea } from './core/cutlist';
import { buildDrawingBundleSvg, buildDrawingSheets } from './core/drawing';
import { hingeCount, listHandles, listHinges } from './core/hardware';
import { buildCutplanDxf, buildCutplanSvg, nestParts } from './core/nesting';
import { applyOverrides, emptyOverrides, hasOverrides } from './core/overrides';
import { buildPartsDxf } from './core/partdxf';
import { instantiateCatalogPart, PARTS_CATALOG } from './core/partscatalog';
import { loadSettings, saveSettings, type AppSettings } from './core/settings';
import { snapValue } from './core/snapping';
import { BLANK_STARTS, PREBUILDS, prebuildThumbSvg } from './core/prebuilds';
import {
  deleteProject,
  exportProjects,
  importProjects,
  latestVersion,
  loadProjects,
  saveVersion,
} from './core/projects';
import { WOODS } from './core/wood';
import { Viewer, type SectionAxis, type ViewPreset } from './viewer/viewer';
import type { Assembly, CabinetParams, FurnitureType, HardwareOptions, Overrides, PartSpec } from './core/types';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Element #${id} fehlt`);
  return node as T;
}

const inputs = {
  type: el<HTMLSelectElement>('p-type'),
  width: el<HTMLInputElement>('p-width'),
  height: el<HTMLInputElement>('p-height'),
  depth: el<HTMLInputElement>('p-depth'),
  thickness: el<HTMLSelectElement>('p-thickness'),
  shelves: el<HTMLInputElement>('p-shelves'),
  door: el<HTMLInputElement>('p-door'),
  drawers: el<HTMLInputElement>('p-drawers'),
  material: el<HTMLSelectElement>('p-material'),
  hwHinge: el<HTMLSelectElement>('hw-hinge'),
  hwHandle: el<HTMLSelectElement>('hw-handle'),
  hwPins: el<HTMLInputElement>('hw-pins'),
  hwHangers: el<HTMLInputElement>('hw-hangers'),
};

// Material-Auswahl füllen (Rückwand/Dübel haben feste Materialien)
for (const wood of Object.values(WOODS)) {
  if (wood.key === 'hdf') continue;
  const option = document.createElement('option');
  option.value = wood.key;
  option.textContent = wood.label;
  inputs.material.appendChild(option);
}
inputs.material.value = DEFAULT_PARAMS.materialKey;

// Standard-Material-Auswahl in den Einstellungen befüllen
const setDefMaterial = el<HTMLSelectElement>('set-def-material');
for (const wood of Object.values(WOODS)) {
  if (wood.key === 'hdf') continue;
  const option = document.createElement('option');
  option.value = wood.key;
  option.textContent = wood.label;
  setDefMaterial.appendChild(option);
}

// Möbeltyp-Auswahl befüllen
for (const [key, info] of Object.entries(FURNITURE_TYPES)) {
  const option = document.createElement('option');
  option.value = key;
  option.textContent = info.label;
  inputs.type.appendChild(option);
}
inputs.type.value = DEFAULT_PARAMS.type;

// Gespeicherte Herstellerkataloge in die Beschläge-Registry übernehmen
applyStoredCatalogs();

/** Scharnier-/Griff-Auswahl aus der Registry befüllen (Auswahl bleibt erhalten) */
function populateHardwareSelects(): void {
  const fill = (select: HTMLSelectElement, entries: [string, { label: string; fromCatalog?: string }][]) => {
    const current = select.value;
    select.innerHTML = '';
    for (const [key, def] of entries) {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = def.fromCatalog ? `${def.label} [${def.fromCatalog}]` : def.label;
      select.appendChild(option);
    }
    const none = document.createElement('option');
    none.value = 'none';
    none.textContent = 'ohne';
    select.appendChild(none);
    select.value = [...select.options].some((o) => o.value === current) ? current : select.options[0].value;
  };
  fill(inputs.hwHinge, listHinges());
  fill(inputs.hwHandle, listHandles());
}
populateHardwareSelects();

let settings: AppSettings = loadSettings();
let params: CabinetParams = { ...DEFAULT_PARAMS };
let assembly: Assembly;
/** Anzeigename des aktuellen Dokuments (Projekt/Vorlage) + Versionsstand */
let docLabel: string | null = null;
let docVersion: number | null = null;
/** Interaktive Bearbeitungen (Browser/Zeitleiste), Teil des Dokuments */
let overrides: Overrides = emptyOverrides();
let selectedPartId: string | null = null;

const explodeSlider = el<HTMLInputElement>('explode');
const animButton = el<HTMLButtonElement>('btn-anim');
const dimsCheckbox = el<HTMLInputElement>('dims');
const measureCheckbox = el<HTMLInputElement>('measure');
const sectionOn = el<HTMLInputElement>('section-on');
const sectionAxis = el<HTMLSelectElement>('section-axis');
const sectionPos = el<HTMLInputElement>('section-pos');
const orthoCheckbox = el<HTMLInputElement>('ortho');
const scrub = el<HTMLInputElement>('tl-scrub');

const viewer = new Viewer(el('viewport'), el('labels'), el('viewcube'), {
  onSelect: showPartInfo,
  onAnimationEnd: () => {
    explodeSlider.value = '0';
    explodeSlider.disabled = false;
    scrub.disabled = false;
    animButton.textContent = '▶ Montage';
    setTimelineUi(assembly.stepCount);
  },
  onAnimationProgress: (step) => setTimelineUi(Math.floor(step)),
  onTransform: (partId, delta) => {
    const ov = partOverride(partId);
    ov.offset ??= [0, 0, 0];
    ov.offset[0] += delta[0];
    ov.offset[1] += delta[1];
    ov.offset[2] += delta[2];
    rebuild();
    viewer.selectPart(partId);
  },
  onMeasure: (result) => {
    el('measure-result').textContent = result
      ? `Abstand: ${result.distance.toFixed(1)} mm  (Δx ${result.dx.toFixed(0)} · Δy ${result.dy.toFixed(0)} · Δz ${result.dz.toFixed(0)})`
      : measureCheckbox.checked
        ? 'Messen: zwei Punkte anklicken'
        : '';
  },
});

function readParams(): CabinetParams {
  return clampParams({
    type: inputs.type.value as FurnitureType,
    width: Number(inputs.width.value) || DEFAULT_PARAMS.width,
    height: Number(inputs.height.value) || DEFAULT_PARAMS.height,
    depth: Number(inputs.depth.value) || DEFAULT_PARAMS.depth,
    thickness: Number(inputs.thickness.value),
    shelves: Number(inputs.shelves.value) || 0,
    door: inputs.door.checked,
    drawers: inputs.drawers.checked,
    materialKey: inputs.material.value,
    hardware: {
      hinge: inputs.hwHinge.value as HardwareOptions['hinge'],
      handle: inputs.hwHandle.value as HardwareOptions['handle'],
      shelfPins: inputs.hwPins.checked,
      hangers: inputs.hwHangers.checked,
    },
  });
}

function writeParams(p: CabinetParams): void {
  inputs.width.value = String(p.width);
  inputs.height.value = String(p.height);
  inputs.depth.value = String(p.depth);
  inputs.shelves.value = String(p.shelves);
}

function rebuild(): void {
  if (viewer.isAnimating) stopAnimation();
  params = readParams();
  writeParams(params); // geclampte Werte zurückspiegeln
  assembly = applyOverrides(buildFurniture(params), overrides, params.materialKey);
  viewer.setAssembly(assembly);
  viewer.setExplode(Number(explodeSlider.value) / 100);
  applySection();
  renderTree();
  renderTimeline();
  renderStepList();
  renderHistory();
  renderCutlist();
  renderStatus();
  el('doc-name').textContent =
    `${docLabel ?? assembly.name}${docVersion ? ` v${docVersion}` : ''} — ${params.width} × ${params.height} × ${params.depth} mm`;
  el('pe-reset').hidden = !hasOverrides(overrides);
  applyTypeUi();
}

/** Bearbeitung am ausgewählten Teil anwenden und Auswahl erhalten */
function editSelected(mutate: (id: string) => void): void {
  if (!selectedPartId) return;
  const id = selectedPartId;
  mutate(id);
  rebuild();
  viewer.selectPart(id);
}

function partOverride(id: string) {
  overrides.parts[id] ??= {};
  return overrides.parts[id];
}

/** Parameterfelder, Grenzen und Beschläge-Panel an den Möbeltyp anpassen */
function applyTypeUi(): void {
  const info = FURNITURE_TYPES[params.type];
  for (const [input, lim] of [
    [inputs.width, info.limits.width],
    [inputs.height, info.limits.height],
    [inputs.depth, info.limits.depth],
    [inputs.shelves, info.limits.shelves],
  ] as const) {
    input.min = String(lim.min);
    input.max = String(lim.max);
  }
  el('lbl-shelves').hidden = !info.uses.shelves;
  inputs.shelves.hidden = !info.uses.shelves;
  el('lbl-door').hidden = !info.uses.door;
  el('row-door').hidden = !info.uses.door;
  el('lbl-drawers').hidden = !info.uses.door;
  el('row-drawers').hidden = !info.uses.door;
  inputs.door.disabled = params.drawers;
  inputs.shelves.disabled = params.drawers;

  const hardwareOn = info.uses.hardware;
  inputs.hwHinge.disabled = !hardwareOn;
  inputs.hwHandle.disabled = !hardwareOn;
  inputs.hwPins.disabled = !hardwareOn;
  inputs.hwHangers.disabled = !hardwareOn;
  el('hw-note').textContent = !hardwareOn
    ? `Für den Typ «${info.label}» sind die Verbindungen im Modell fest eingeplant (gedübelt).`
    : params.drawers
      ? `${assembly.subtitle} — Griffe und Auszüge werden je Front automatisch gesetzt.`
      : params.door && params.hardware.hinge !== 'none'
        ? `${hingeCount(params.height - 4)} Scharniere bei Türhöhe ${params.height - 4} mm (Bohrbild System 32).`
        : 'Ohne Tür entfallen Scharniere und Griff.';
}

// ---------------------------------------------------------- Browser-Baum

// Kategorien als Prädikate, damit auch Katalog-Beschläge und neue
// Möbeltypen richtig einsortiert werden; Rest fällt in «Weitere Bauteile».
const TREE_GROUPS: [string, (p: PartSpec) => boolean][] = [
  ['Korpus', (p) => ['Seite', 'Korpusboden', 'Korpusdeckel', 'Regalboden'].includes(p.groupKey)],
  ['Gestell', (p) => ['Tischbein', 'Zarge lang', 'Zarge kurz'].includes(p.groupKey)],
  ['Platte', (p) => p.groupKey === 'Tischplatte'],
  ['Rückwand', (p) => p.groupKey === 'Rückwand'],
  ['Ausstattung', (p) => p.groupKey === 'Einlegeboden'],
  ['Front', (p) => p.groupKey === 'Tür'],
  ['Beschläge', (p) => p.materialKey === 'metal'],
  ['Verbindungen', (p) => p.groupKey === 'Holzdübel'],
];

function renderTree(): void {
  const tree = el('tree');
  tree.innerHTML = '';
  const matched = new Set<string>();
  const groups: [string, PartSpec[]][] = TREE_GROUPS.map(([category, match]) => {
    const parts = assembly.parts.filter(match);
    for (const part of parts) matched.add(part.id);
    return [category, parts];
  });
  // Umbenannte Teile und Kopien fallen in «Bearbeitete Teile»
  const rest = assembly.parts.filter((p) => !matched.has(p.id));
  if (rest.length > 0) groups.push(['Bearbeitete Teile', rest]);
  for (const [category, parts] of groups) {
    if (parts.length === 0) continue;
    const details = document.createElement('details');
    details.open = !['Verbindungen', 'Beschläge'].includes(category);
    const summary = document.createElement('summary');
    summary.textContent = `${category} (${parts.length})`;
    details.appendChild(summary);
    for (const part of parts) {
      const row = document.createElement('div');
      row.className = 'tree-item';
      row.dataset.partId = part.id;

      const eye = document.createElement('button');
      eye.className = 'eye';
      eye.textContent = '👁';
      eye.title = 'Ein-/Ausblenden';
      eye.setAttribute('aria-pressed', 'true');
      eye.addEventListener('click', (e) => {
        e.stopPropagation();
        const nowVisible = eye.getAttribute('aria-pressed') !== 'true';
        eye.setAttribute('aria-pressed', String(nowVisible));
        eye.textContent = nowVisible ? '👁' : '🚫';
        viewer.setPartVisible(part.id, nowVisible);
      });

      const name = document.createElement('span');
      name.className = 'ti-name';
      name.textContent = part.name;

      const step = document.createElement('span');
      step.className = 'ti-step';
      step.textContent = `S${part.step}`;
      step.title = `Montagestufe ${part.step}: ${assembly.stepNames[part.step - 1] ?? ''}`;

      const del = document.createElement('button');
      del.className = 'ti-del';
      del.textContent = '✕';
      del.title = 'Bauteil löschen (unterdrücken)';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        partOverride(part.id).suppressed = true;
        if (selectedPartId === part.id) viewer.selectPart(null);
        rebuild();
      });

      row.draggable = true;
      row.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('text/plain', part.id);
        row.classList.add('dragging');
      });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
      // Ziel: Bauteil auf ein anderes ziehen → gleiche Montagestufe übernehmen
      row.addEventListener('dragover', (e) => {
        if (!e.dataTransfer?.types.includes('text/plain')) return;
        e.preventDefault();
        row.classList.add('drop-target');
      });
      row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('drop-target');
        const srcId = e.dataTransfer?.getData('text/plain');
        if (!srcId || srcId === part.id) return;
        partOverride(srcId).step = part.step;
        rebuild();
        viewer.selectPart(srcId);
      });
      row.addEventListener('click', () => viewer.selectPart(part.id));

      row.append(eye, name, step, del);
      details.appendChild(row);
    }
    tree.appendChild(details);
  }
}

function syncTreeSelection(part: PartSpec | null): void {
  for (const row of document.querySelectorAll<HTMLElement>('.tree-item')) {
    row.classList.toggle('selected', part !== null && row.dataset.partId === part.id);
  }
}

// ------------------------------------------------------------- Zeitleiste

function renderTimeline(): void {
  const markers = el('tl-markers');
  markers.innerHTML = '';
  for (let s = 1; s <= assembly.stepCount; s++) {
    const btn = document.createElement('button');
    btn.className = 'tl-marker';
    btn.textContent = String(s);
    btn.title = `Stufe ${s}: ${assembly.stepNames[s - 1] ?? ''}`;
    btn.addEventListener('click', () => {
      scrub.value = String(s);
      applyTimeline();
    });
    markers.appendChild(btn);
  }
  scrub.max = String(assembly.stepCount);
  scrub.value = String(assembly.stepCount);
  setTimelineUi(assembly.stepCount);
  wireTimelineEditing();
}

function setTimelineUi(step: number): void {
  scrub.value = String(step);
  const complete = step >= assembly.stepCount;
  el('tl-state').textContent = complete
    ? 'komplett'
    : step === 0
      ? 'leer'
      : `Stufe ${step}/${assembly.stepCount}: ${assembly.stepNames[step - 1] ?? ''}`;
  const buttons = el('tl-markers').querySelectorAll<HTMLButtonElement>('.tl-marker');
  buttons.forEach((b, i) => {
    b.classList.toggle('done', i + 1 < step);
    b.classList.toggle('current', i + 1 === step);
  });
}

function applyTimeline(): void {
  const step = Number(scrub.value);
  viewer.setTimelineStep(step >= assembly.stepCount ? null : step);
  setTimelineUi(step);
}

// ------------------------------------------------ Konstruktionsverlauf

/** Montagestufen-Liste (umbenennen, Teile per Ziehen zuordnen, Stufe anlegen) */
function renderStepList(): void {
  const list = el('step-list');
  list.innerHTML = '';
  const counts = new Array(assembly.stepCount + 1).fill(0);
  for (const p of assembly.parts) counts[p.step] = (counts[p.step] ?? 0) + 1;
  for (let s = 1; s <= assembly.stepCount; s++) {
    const row = document.createElement('div');
    row.className = 'step-row';
    row.dataset.step = String(s);

    const badge = document.createElement('span');
    badge.className = 'step-badge';
    badge.textContent = String(s);

    const nameInput = document.createElement('input');
    nameInput.className = 'step-name';
    nameInput.value = assembly.stepNames[s - 1] ?? `Stufe ${s}`;
    nameInput.title = 'Stufenname bearbeiten';
    nameInput.addEventListener('change', () => {
      const v = nameInput.value.trim();
      if (v === '' || v === (assembly.stepNames[s - 1] ?? '')) delete overrides.stepNames[s];
      else overrides.stepNames[s] = v;
      rebuild();
    });

    const count = document.createElement('span');
    count.className = 'step-count';
    count.textContent = `${counts[s] ?? 0}×`;

    // Ziel: Bauteil aus dem Browser auf die Stufe ziehen
    row.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('text/plain')) return;
      e.preventDefault();
      row.classList.add('drop-target');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('drop-target');
      const id = e.dataTransfer?.getData('text/plain');
      if (!id) return;
      partOverride(id).step = s;
      rebuild();
      viewer.selectPart(id);
    });

    row.append(badge, nameInput, count);
    list.appendChild(row);
  }
}

/** Bearbeitungsverlauf: jede Override-Operation als einzeln rücknehmbarer Eintrag */
function renderHistory(): void {
  const list = el('hist-list');
  list.innerHTML = '';
  const nameOf = (id: string): string =>
    assembly.parts.find((p) => p.id === id)?.name ?? overrides.additions?.find((a) => a.id === id)?.name ?? id;

  type Entry = { label: string; undo: () => void };
  const entries: Entry[] = [];

  for (const add of overrides.additions ?? []) {
    entries.push({
      label: `➕ ${add.name} eingefügt`,
      undo: () => {
        overrides.additions = (overrides.additions ?? []).filter((a) => a.id !== add.id);
        delete overrides.parts[add.id];
      },
    });
  }
  for (const copy of overrides.copies) {
    entries.push({
      label: `⧉ Kopie von ${nameOf(copy.sourceId)}`,
      undo: () => {
        overrides.copies = overrides.copies.filter((c) => c.id !== copy.id);
        delete overrides.parts[copy.id];
      },
    });
  }
  for (const [id, ov] of Object.entries(overrides.parts)) {
    if (ov.suppressed) entries.push({ label: `🗑 ${nameOf(id)} gelöscht`, undo: () => { delete overrides.parts[id].suppressed; } });
    if (ov.name) entries.push({ label: `✎ umbenannt zu «${ov.name}»`, undo: () => { delete overrides.parts[id].name; } });
    if (ov.size) entries.push({ label: `⤢ ${nameOf(id)} Mass geändert`, undo: () => { delete overrides.parts[id].size; } });
    if (ov.offset && ov.offset.some((v) => v !== 0)) entries.push({ label: `↔ ${nameOf(id)} verschoben`, undo: () => { delete overrides.parts[id].offset; } });
    if (ov.chamfer) entries.push({ label: `◣ ${nameOf(id)} Kante gebrochen (r${ov.chamfer})`, undo: () => { delete overrides.parts[id].chamfer; } });
    if (ov.step) entries.push({ label: `↕ ${nameOf(id)} → Stufe ${ov.step}`, undo: () => { delete overrides.parts[id].step; } });
  }
  for (const [step, name] of Object.entries(overrides.stepNames)) {
    entries.push({ label: `🏷 Stufe ${step} = «${name}»`, undo: () => { delete overrides.stepNames[Number(step)]; } });
  }
  if ((overrides.extraSteps ?? 0) > 0) {
    entries.push({ label: `＋ ${overrides.extraSteps} zusätzliche Stufe(n)`, undo: () => { overrides.extraSteps = Math.max(0, (overrides.extraSteps ?? 0) - 1); } });
  }

  el('hist-empty').hidden = entries.length > 0;
  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'hist-row';
    const label = document.createElement('span');
    label.className = 'hist-label';
    label.textContent = entry.label;
    const undo = document.createElement('button');
    undo.className = 'ti-del';
    undo.textContent = '↺';
    undo.title = 'Diese Bearbeitung zurücknehmen';
    undo.addEventListener('click', () => {
      entry.undo();
      // leere Teil-Overrides aufräumen
      for (const [id, ov] of Object.entries(overrides.parts)) {
        if (Object.keys(ov).length === 0) delete overrides.parts[id];
      }
      rebuild();
    });
    row.append(label, undo);
    list.appendChild(row);
  }
}

// ------------------------------------------------------------ Stückliste

function renderCutlist(): void {
  const rows = buildCutlist(assembly);
  const tbody = el<HTMLTableSectionElement>('cutlist').querySelector('tbody')!;
  tbody.innerHTML = '';
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.dataset.group = row.name;
    for (const value of [row.pos, row.name, row.count, row.dims, row.material]) {
      const td = document.createElement('td');
      td.textContent = String(value);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  el('area-total').textContent = `Plattenbedarf gesamt: ${totalArea(rows).toFixed(2)} m² (netto, ohne Verschnitt)`;

  // Kantenband-Bedarf (Umfang der sichtbaren Plattenteile), wenn aktiviert
  if (settings.edgeBanding) {
    let edgeMm = 0;
    for (const p of assembly.parts) {
      if (p.shape === 'box' && p.cut && p.materialKey !== 'metal') {
        edgeMm += 2 * (p.cut.length + p.cut.width);
      }
    }
    el('eb-total').textContent = `Kantenband-Bedarf: ${(edgeMm / 1000).toFixed(1)} m (${settings.edgeBandingThickness} mm, alle Plattenkanten)`;
    el('eb-total').hidden = false;
  } else {
    el('eb-total').hidden = true;
  }
}

function downloadCsv(): void {
  const csv = cutlistToCsv(buildCutlist(assembly));
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }); // BOM für Excel-Umlaute
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `stueckliste-${assemblySlug(assembly)}-${params.width}x${params.height}x${params.depth}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// --------------------------------------------------------- Bauteil-Panel

function showPartInfo(part: PartSpec | null): void {
  selectedPartId = part?.id ?? null;
  if (part) showInspTab('bauteil');
  const edit = el('part-edit');
  edit.hidden = part === null;
  if (part) {
    el<HTMLInputElement>('pe-name').value = '';
    el<HTMLInputElement>('pe-name').placeholder = part.name;
    const stepSel = el<HTMLSelectElement>('pe-step');
    stepSel.innerHTML = '';
    for (let st = 1; st <= assembly.stepCount; st++) {
      const option = document.createElement('option');
      option.value = String(st);
      option.textContent = `${st} — ${assembly.stepNames[st - 1] ?? ''}`;
      stepSel.appendChild(option);
    }
    stepSel.value = String(part.step);
    el<HTMLInputElement>('pe-sx').value = String(Math.round(part.size[0]));
    el<HTMLInputElement>('pe-sy').value = String(Math.round(part.size[1]));
    el<HTMLInputElement>('pe-sz').value = String(Math.round(part.size[2]));
    const sizeEditable = part.shape === 'box';
    el<HTMLInputElement>('pe-sx').disabled = !sizeEditable;
    el<HTMLInputElement>('pe-sy').disabled = !sizeEditable;
    el<HTMLInputElement>('pe-sz').disabled = !sizeEditable;
  }
  el('pe-note').hidden = part === null;
  syncTreeSelection(part);
  for (const tr of document.querySelectorAll<HTMLTableRowElement>('#cutlist tbody tr')) {
    tr.classList.toggle('active', part !== null && tr.dataset.group === part.groupKey);
  }

  const empty = el('part-empty');
  const info = el('part-info');
  if (!part) {
    empty.hidden = false;
    info.hidden = true;
    return;
  }
  empty.hidden = true;
  info.hidden = false;
  el('pi-name').textContent = part.name;
  el('pi-dims').textContent = part.cut
    ? `${part.cut.length} × ${part.cut.width} × ${part.cut.thickness} mm`
    : `${part.cutNote ?? '—'} mm`;
  el('pi-material').textContent =
    part.materialKey === 'metal'
      ? 'Edelstahl'
      : part.materialKey === 'bore'
        ? 'Bohrung (Referenz)'
        : WOODS[part.materialKey]?.label ?? part.materialKey;
  el('pi-grain').textContent = { x: 'quer (x)', y: 'stehend (y)', z: 'tief (z)' }[part.grain];
  el('pi-step').textContent = `${part.step} von ${assembly.stepCount}`;
}

// ---------------------------------------------------------------- Status

function renderStatus(): void {
  const { width, height, depth } = assembly.overall;
  el('status-dims').textContent = `Aussenmass: ${width} × ${height} × ${depth} mm (B × H × T)`;
  el('status-parts').textContent = `${assembly.parts.length} Bauteile`;
}

// ---------------------------------------------------------------- Events

for (const input of Object.values(inputs)) {
  input.addEventListener('change', rebuild);
}

explodeSlider.addEventListener('input', () => {
  viewer.setExplode(Number(explodeSlider.value) / 100);
});

function startAnimation(): void {
  explodeSlider.disabled = true;
  scrub.disabled = true;
  animButton.textContent = '⏹ Stopp';
  viewer.playAnimation();
}

function stopAnimation(): void {
  viewer.stopAnimation();
  explodeSlider.disabled = false;
  scrub.disabled = false;
  animButton.textContent = '▶ Montage';
  setTimelineUi(assembly.stepCount);
}

animButton.addEventListener('click', () => {
  if (viewer.isAnimating) stopAnimation();
  else startAnimation();
});

// Inspector-Tabs: Entwurf · Bauteil · Verlauf · Liste · Projekte
function showInspTab(tab: string): void {
  for (const btn of document.querySelectorAll<HTMLElement>('.insp-tab')) {
    btn.classList.toggle('active', btn.dataset.inspTab === tab);
  }
  for (const panel of document.querySelectorAll<HTMLElement>('[data-insp]')) {
    panel.hidden = panel.dataset.insp !== tab;
  }
}
for (const btn of document.querySelectorAll<HTMLElement>('.insp-tab')) {
  btn.addEventListener('click', () => showInspTab(btn.dataset.inspTab!));
}
showInspTab('entwurf');

// Zusätzliche Montagestufe anlegen (Konstruktionsverlauf)
el<HTMLButtonElement>('btn-step-add').addEventListener('click', () => {
  overrides.extraSteps = (overrides.extraSteps ?? 0) + 1;
  rebuild();
});

// Vorkonfigurierten Blum-Katalog mit einem Klick laden
el<HTMLButtonElement>('btn-cat-blum').addEventListener('click', () => {
  const button = el<HTMLButtonElement>('btn-cat-blum');
  button.disabled = true;
  const original = button.textContent;
  button.textContent = 'Lade …';
  void fetchCatalog('catalogs/blum.json')
    .then((catalog) => {
      importCatalog(catalog, 'catalogs/blum.json');
      button.textContent = `✓ Blum (${catalog.items.length} Artikel)`;
    })
    .catch((err: Error) => {
      button.textContent = `Fehler: ${err.message}`;
    })
    .finally(() => {
      button.disabled = false;
      window.setTimeout(() => (button.textContent = original), 3000);
    });
});

// Vorlagen-Chips
const PRESETS: Record<string, Partial<CabinetParams>> = {
  bad: { type: 'haengeschrank', width: 400, height: 600, depth: 250, shelves: 1, door: true },
  kueche: { type: 'haengeschrank', width: 800, height: 600, depth: 320, shelves: 2, door: true },
  regal: { type: 'haengeschrank', width: 1200, height: 900, depth: 300, shelves: 3, door: false },
  esstisch: { type: 'tisch', width: 1800, height: 750, depth: 900, thickness: 25 },
  buecherregal: { type: 'regal', width: 900, height: 1800, depth: 300, shelves: 4 },
};
for (const chip of document.querySelectorAll<HTMLButtonElement>('[data-preset]')) {
  chip.addEventListener('click', () => {
    const preset = PRESETS[chip.dataset.preset!];
    if (!preset) return;
    if (preset.type !== undefined) inputs.type.value = preset.type;
    if (preset.width !== undefined) inputs.width.value = String(preset.width);
    if (preset.height !== undefined) inputs.height.value = String(preset.height);
    if (preset.depth !== undefined) inputs.depth.value = String(preset.depth);
    if (preset.thickness !== undefined) inputs.thickness.value = String(preset.thickness);
    if (preset.shelves !== undefined) inputs.shelves.value = String(preset.shelves);
    if (preset.door !== undefined) inputs.door.checked = preset.door;
    inputs.drawers.checked = false;
    docLabel = null;
    docVersion = null;
    overrides = emptyOverrides();
    rebuild();
  });
}

dimsCheckbox.addEventListener('change', () => {
  viewer.setDimensionsVisible(dimsCheckbox.checked);
});

measureCheckbox.addEventListener('change', () => {
  viewer.setMeasureMode(measureCheckbox.checked);
  el('measure-hint').hidden = !measureCheckbox.checked;
  el('measure-result').textContent = measureCheckbox.checked
    ? 'Messen: zwei Punkte anklicken'
    : '';
});

function applySection(): void {
  const on = sectionOn.checked;
  sectionAxis.disabled = !on;
  sectionPos.disabled = !on;
  viewer.setSection(on, sectionAxis.value as SectionAxis, Number(sectionPos.value) / 100);
}
sectionOn.addEventListener('change', applySection);
sectionAxis.addEventListener('change', applySection);
sectionPos.addEventListener('input', applySection);

orthoCheckbox.addEventListener('change', () => {
  viewer.setProjection(orthoCheckbox.checked ? 'ortho' : 'persp');
});

scrub.addEventListener('input', applyTimeline);

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
  button.addEventListener('click', () => viewer.setView(button.dataset.view as ViewPreset));
}

el<HTMLButtonElement>('btn-screenshot').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = viewer.screenshot();
  a.download = 'schreiner-cad.png';
  a.click();
});

el<HTMLButtonElement>('btn-csv').addEventListener('click', downloadCsv);

// -------------------------------------------------- Fertigungs-Dialog

type DialogTab = 'drawing' | 'cutplan';
let dialogTab: DialogTab = 'drawing';

function downloadBlob(data: BlobPart, mime: string, filename: string): void {
  const blob = new Blob([data], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function dialogSvg(): string {
  return dialogTab === 'drawing'
    ? buildDrawingSheets(assembly, params).map((sheet) => `<div class="sheet">${sheet}</div>`).join('')
    : buildCutplanSvg(nestParts(assembly, settings), settings);
}

function dialogDownloadSvg(): string {
  return dialogTab === 'drawing' ? buildDrawingBundleSvg(assembly, params) : buildCutplanSvg(nestParts(assembly, settings), settings);
}

function openDialog(tab: DialogTab): void {
  dialogTab = tab;
  el('tab-drawing').classList.toggle('active', tab === 'drawing');
  el('tab-cutplan').classList.toggle('active', tab === 'cutplan');
  el('btn-dl-dxf').hidden = tab !== 'cutplan';
  el('dialog-body').innerHTML = dialogSvg();
  el('dialog-backdrop').hidden = false;
  document.body.classList.add('print-doc');
}

function closeDialog(): void {
  el('dialog-backdrop').hidden = true;
  document.body.classList.remove('print-doc');
}

el('btn-drawing').addEventListener('click', () => openDialog('drawing'));
el('btn-cutplan').addEventListener('click', () => openDialog('cutplan'));
el('tab-drawing').addEventListener('click', () => openDialog('drawing'));
el('tab-cutplan').addEventListener('click', () => openDialog('cutplan'));
el('btn-dlg-close').addEventListener('click', closeDialog);
el('dialog-backdrop').addEventListener('click', (e) => {
  if (e.target === el('dialog-backdrop')) closeDialog();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !el<HTMLElement>('dialog-backdrop').hidden) closeDialog();
});

el('btn-print').addEventListener('click', () => window.print());
el('btn-dl-svg').addEventListener('click', () => {
  const name = dialogTab === 'drawing' ? 'werkzeichnung' : 'zuschnittplan';
  downloadBlob(dialogDownloadSvg(), 'image/svg+xml', `${name}-${params.width}x${params.height}x${params.depth}.svg`);
});
el('btn-dl-dxf').addEventListener('click', () => {
  downloadBlob(
    buildCutplanDxf(nestParts(assembly, settings), settings),
    'application/dxf',
    `zuschnittplan-${params.width}x${params.height}x${params.depth}.dxf`,
  );
});

el<HTMLButtonElement>('btn-glb').addEventListener('click', () => {
  void viewer.exportGlb().then((buffer) => {
    downloadBlob(buffer, 'model/gltf-binary', `${assemblySlug(assembly)}-${params.width}x${params.height}x${params.depth}.glb`);
  });
});

el<HTMLButtonElement>('btn-partdxf').addEventListener('click', () => {
  downloadBlob(
    buildPartsDxf(assembly),
    'application/dxf',
    `bohrbilder-${assemblySlug(assembly)}-${params.width}x${params.height}x${params.depth}.dxf`,
  );
});

/** Kompletten Parametersatz in die Eingabefelder übernehmen und neu aufbauen */
function applyParams(
  p: CabinetParams,
  label: string | null,
  version: number | null,
  ov?: Overrides,
): void {
  inputs.type.value = p.type;
  inputs.width.value = String(p.width);
  inputs.height.value = String(p.height);
  inputs.depth.value = String(p.depth);
  inputs.thickness.value = String(p.thickness);
  inputs.shelves.value = String(p.shelves);
  inputs.door.checked = p.door;
  inputs.drawers.checked = p.drawers;
  inputs.material.value = p.materialKey;
  if ([...inputs.hwHinge.options].some((o) => o.value === p.hardware.hinge)) {
    inputs.hwHinge.value = p.hardware.hinge;
  }
  if ([...inputs.hwHandle.options].some((o) => o.value === p.hardware.handle)) {
    inputs.hwHandle.value = p.hardware.handle;
  }
  inputs.hwPins.checked = p.hardware.shelfPins;
  inputs.hwHangers.checked = p.hardware.hangers;
  docLabel = label;
  docVersion = version;
  overrides = ov ? structuredClone(ov) : emptyOverrides();
  rebuild();
}

// ------------------------------------------------- Interaktives Bearbeiten

el<HTMLButtonElement>('pe-rename').addEventListener('click', () => {
  const name = el<HTMLInputElement>('pe-name').value.trim();
  if (!name) return;
  editSelected((id) => {
    partOverride(id).name = name;
  });
});

el<HTMLSelectElement>('pe-step').addEventListener('change', () => {
  const step = Number(el<HTMLSelectElement>('pe-step').value);
  editSelected((id) => {
    partOverride(id).step = step;
  });
});

for (const axisInput of ['pe-sx', 'pe-sy', 'pe-sz'] as const) {
  el<HTMLInputElement>(axisInput).addEventListener('change', () => {
    const size: [number, number, number] = [
      Number(el<HTMLInputElement>('pe-sx').value),
      Number(el<HTMLInputElement>('pe-sy').value),
      Number(el<HTMLInputElement>('pe-sz').value),
    ];
    if (size.some((v) => !Number.isFinite(v) || v < 3)) return;
    editSelected((id) => {
      partOverride(id).size = size;
    });
  });
}

for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-nudge]')) {
  btn.addEventListener('click', () => {
    const [axis, delta] = btn.dataset.nudge!.split(',').map(Number);
    editSelected((id) => {
      const ov = partOverride(id);
      ov.offset ??= [0, 0, 0];
      ov.offset[axis] += delta;
    });
  });
}

el<HTMLButtonElement>('pe-duplicate').addEventListener('click', () => {
  editSelected((id) => {
    overrides.copies.push({ id: `copy-${crypto.randomUUID()}`, sourceId: id, offset: [30, 30, 0] });
  });
});

el<HTMLButtonElement>('pe-suppress').addEventListener('click', () => {
  if (!selectedPartId) return;
  partOverride(selectedPartId).suppressed = true;
  viewer.selectPart(null);
  rebuild();
});

el<HTMLButtonElement>('pe-reset').addEventListener('click', () => {
  overrides = emptyOverrides();
  viewer.selectPart(null);
  rebuild();
});

// Zeitleiste: Bauteil aus dem Browser auf eine Stufe ziehen; Doppelklick benennt um
function wireTimelineEditing(): void {
  el('tl-markers').querySelectorAll<HTMLButtonElement>('.tl-marker').forEach((marker, i) => {
    const step = i + 1;
    marker.addEventListener('dragover', (e) => {
      e.preventDefault();
      marker.classList.add('drop-target');
    });
    marker.addEventListener('dragleave', () => marker.classList.remove('drop-target'));
    marker.addEventListener('drop', (e) => {
      e.preventDefault();
      marker.classList.remove('drop-target');
      const id = e.dataTransfer?.getData('text/plain');
      if (!id) return;
      partOverride(id).step = step;
      rebuild();
      viewer.selectPart(id);
    });
    marker.addEventListener('dblclick', () => {
      const current = assembly.stepNames[i] ?? '';
      const name = window.prompt(`Name für Stufe ${step}`, current);
      if (name === null) return;
      if (name.trim() === '' || name === current) delete overrides.stepNames[step];
      else overrides.stepNames[step] = name.trim();
      rebuild();
    });
  });
}

// ------------------------------------------------------- Start-Galerie

function card(thumbSvg: string, name: string, desc: string, onOpen: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'card';
  btn.dataset.cardName = name;
  const thumb = document.createElement('div');
  thumb.className = 'thumb';
  thumb.innerHTML = thumbSvg;
  const nameEl = document.createElement('span');
  nameEl.className = 'card-name';
  nameEl.textContent = name;
  const descEl = document.createElement('span');
  descEl.className = 'card-desc';
  descEl.textContent = desc;
  btn.append(thumb, nameEl, descEl);
  btn.addEventListener('click', onOpen);
  return btn;
}

function renderHome(): void {
  const blanks = el('home-blank');
  blanks.innerHTML = '';
  for (const blank of BLANK_STARTS) {
    blanks.appendChild(
      card(prebuildThumbSvg(blank.params), blank.name, 'Leerer Startpunkt', () => {
        applyParams(
          { ...blank.params, materialKey: settings.defaultMaterial, thickness: settings.defaultThickness },
          null,
          null,
        );
        closeHome();
      }),
    );
  }

  const pre = el('home-prebuilds');
  pre.innerHTML = '';
  for (const prebuild of PREBUILDS) {
    pre.appendChild(
      card(prebuildThumbSvg(prebuild.params), prebuild.name, prebuild.description, () => {
        applyParams(prebuild.params, prebuild.name, null);
        closeHome();
      }),
    );
  }

  const projects = loadProjects();
  const grid = el('home-projects');
  grid.innerHTML = '';
  el('home-empty').hidden = projects.length > 0;
  for (const project of projects) {
    const latest = latestVersion(project);
    grid.appendChild(
      card(
        prebuildThumbSvg(latest.params),
        project.name,
        `v${latest.version} · ${latest.savedAt.slice(0, 10)}`,
        () => {
          applyParams(latest.params, project.name, latest.version, latest.overrides);
          closeHome();
        },
      ),
    );
  }
}

function openHome(): void {
  renderHome();
  el('home-backdrop').hidden = false;
}
function closeHome(): void {
  el('home-backdrop').hidden = true;
}
el('btn-home').addEventListener('click', openHome);
el('btn-home-close').addEventListener('click', closeHome);
el('home-backdrop').addEventListener('click', (e) => {
  if (e.target === el('home-backdrop')) closeHome();
});

// ------------------------------------------------------------ Projekte

function renderProjectList(): void {
  const list = el('proj-list');
  list.innerHTML = '';
  for (const project of loadProjects()) {
    const latest = latestVersion(project);
    const row = document.createElement('div');
    row.className = 'proj-entry';
    row.dataset.projectName = project.name;

    const name = document.createElement('span');
    name.className = 'proj-name';
    name.textContent = project.name;
    name.title = `Neueste Version (v${latest.version}) laden`;
    name.addEventListener('click', () => {
      applyParams(latest.params, project.name, latest.version, latest.overrides);
      setStatus('proj-status', `«${project.name}» v${latest.version} geladen.`, true);
    });

    const meta = document.createElement('span');
    meta.className = 'proj-meta';
    meta.textContent = `v${latest.version}`;
    meta.title = 'Versionen anzeigen';
    meta.style.cursor = 'pointer';

    const remove = document.createElement('button');
    remove.className = 'cat-remove';
    remove.textContent = '✕';
    remove.title = 'Projekt (alle Versionen) löschen';
    remove.addEventListener('click', () => {
      deleteProject(project.id);
      renderProjectList();
      setStatus('proj-status', `Projekt «${project.name}» gelöscht.`, true);
    });

    row.append(name, meta, remove);
    list.appendChild(row);

    // Versionsliste (aufklappbar über die v-Nummer)
    const versions = document.createElement('div');
    versions.className = 'ver-list';
    versions.hidden = true;
    for (const v of [...project.versions].reverse()) {
      const vr = document.createElement('div');
      vr.className = 'ver-row';
      vr.dataset.version = String(v.version);
      vr.textContent = `v${v.version} — ${v.savedAt.slice(0, 16).replace('T', ' ')} · ${v.params.width}×${v.params.height}×${v.params.depth}`;
      vr.title = 'Diese Version laden';
      vr.addEventListener('click', () => {
        applyParams(v.params, project.name, v.version, v.overrides);
        setStatus('proj-status', `«${project.name}» v${v.version} geladen.`, true);
      });
      versions.appendChild(vr);
    }
    meta.addEventListener('click', (e) => {
      e.stopPropagation();
      versions.hidden = !versions.hidden;
    });
    list.appendChild(versions);
  }
}
renderProjectList();

el<HTMLButtonElement>('btn-proj-save').addEventListener('click', () => {
  const name = el<HTMLInputElement>('proj-name').value.trim() ||
    docLabel ||
    `${assembly.name} ${params.width}×${params.height}×${params.depth}`;
  const { version } = saveVersion(name, params, overrides);
  docLabel = name;
  docVersion = version;
  el<HTMLInputElement>('proj-name').value = '';
  renderProjectList();
  renderStatus();
  el('doc-name').textContent =
    `${name} v${version} — ${params.width} × ${params.height} × ${params.depth} mm`;
  setStatus('proj-status', `«${name}» als v${version} gespeichert.`, true);
});

el<HTMLButtonElement>('btn-proj-export').addEventListener('click', () => {
  downloadBlob(exportProjects(), 'application/json', 'schreinercad-projekte.json');
});

el<HTMLButtonElement>('btn-proj-import').addEventListener('click', () => {
  el<HTMLInputElement>('proj-file').click();
});

el<HTMLInputElement>('proj-file').addEventListener('change', () => {
  const file = el<HTMLInputElement>('proj-file').files?.[0];
  if (!file) return;
  void file
    .text()
    .then((text) => {
      const merged = importProjects(text);
      renderProjectList();
      setStatus('proj-status', `${merged.length} Projekte verfügbar.`, true);
    })
    .catch((err: Error) => setStatus('proj-status', `Einlesen fehlgeschlagen: ${err.message}`, false));
  el<HTMLInputElement>('proj-file').value = '';
});

// ------------------------------------------------ Herstellerkataloge

function setStatus(id: string, message: string, ok: boolean): void {
  const node = el(id);
  node.textContent = message;
  node.classList.toggle('status-ok', ok);
  node.classList.toggle('status-err', !ok);
}

function renderCatalogList(): void {
  const list = el('cat-list');
  list.innerHTML = '';
  for (const entry of loadStoredCatalogs()) {
    const row = document.createElement('div');
    row.className = 'cat-entry';
    row.dataset.vendor = entry.catalog.vendor;

    const name = document.createElement('span');
    name.className = 'cat-name';
    name.textContent = entry.catalog.vendor;
    name.title = `${entry.catalog.note ?? ''}\nQuelle: ${entry.source}`.trim();

    const count = document.createElement('span');
    count.className = 'cat-count';
    count.textContent = `${entry.catalog.items.length} Artikel`;

    const remove = document.createElement('button');
    remove.className = 'cat-remove';
    remove.textContent = '✕';
    remove.title = 'Katalog entfernen';
    remove.addEventListener('click', () => {
      removeCatalog(entry.catalog.vendor);
      populateHardwareSelects();
      renderCatalogList();
      setStatus('cat-status', `Katalog «${entry.catalog.vendor}» entfernt.`, true);
      rebuild();
    });

    row.append(name, count, remove);
    list.appendChild(row);
  }
}
renderCatalogList();

function importCatalog(catalog: ReturnType<typeof validateCatalog>, source: string): void {
  addCatalog(catalog, source);
  populateHardwareSelects();
  renderCatalogList();
  setStatus(
    'cat-status',
    `Katalog «${catalog.vendor}» übernommen (${catalog.items.length} Artikel).` +
      (catalog.note ? ` Hinweis: ${catalog.note}` : ''),
    true,
  );
  rebuild();
}

el<HTMLButtonElement>('btn-cat-import').addEventListener('click', () => {
  el<HTMLInputElement>('cat-file').click();
});

el<HTMLInputElement>('cat-file').addEventListener('change', () => {
  const file = el<HTMLInputElement>('cat-file').files?.[0];
  if (!file) return;
  void file
    .text()
    .then((text) => importCatalog(validateCatalog(JSON.parse(text)), `Datei: ${file.name}`))
    .catch((err: Error) => setStatus('cat-status', `Import fehlgeschlagen: ${err.message}`, false));
  el<HTMLInputElement>('cat-file').value = '';
});

el<HTMLButtonElement>('btn-cat-sync').addEventListener('click', () => {
  const url = el<HTMLInputElement>('cat-url').value.trim();
  if (!url) {
    setStatus('cat-status', 'Bitte Katalog-URL angeben.', false);
    return;
  }
  setStatus('cat-status', 'Synchronisiere …', true);
  void fetchCatalog(url)
    .then((catalog) => importCatalog(catalog, url))
    .catch((err: Error) => setStatus('cat-status', `Sync fehlgeschlagen: ${err.message}`, false));
});

// ------------------------------------------------ BOM-Export & ERP-Sync

el<HTMLButtonElement>('btn-bom-json').addEventListener('click', () => {
  const bom = buildBom(assembly, params);
  downloadBlob(JSON.stringify(bom, null, 2), 'application/json', `${bom.document}-bom.json`);
});

el<HTMLButtonElement>('btn-bom-sync').addEventListener('click', () => {
  if (!settings.erpEndpoint) {
    setStatus('bom-status', 'ERP-Endpunkt in den Einstellungen (⚙) festlegen.', false);
    return;
  }
  const button = el<HTMLButtonElement>('btn-bom-sync');
  button.disabled = true;
  setStatus('bom-status', 'Übertrage …', true);
  void syncBom(buildBom(assembly, params), settings.erpEndpoint, settings.erpApiKey || undefined).then(
    (result) => {
      button.disabled = false;
      setStatus('bom-status', result.message, result.ok);
    },
  );
});

// ------------------------------------------------------- Einstellungen (⚙)

function openSettings(): void {
  el<HTMLInputElement>('set-erp-endpoint').value = settings.erpEndpoint;
  el<HTMLInputElement>('set-erp-key').value = settings.erpApiKey;
  el<HTMLInputElement>('set-cat-autosync').checked = settings.catalogAutoSync;
  el<HTMLInputElement>('set-grid').value = String(settings.gridSnap);
  el<HTMLInputElement>('set-snap-part').checked = settings.snapToPart;
  el<HTMLInputElement>('set-sheet-l').value = String(settings.sheetLength);
  el<HTMLInputElement>('set-sheet-w').value = String(settings.sheetWidth);
  el<HTMLInputElement>('set-kerf').value = String(settings.kerf);
  el<HTMLInputElement>('set-trim').value = String(settings.trim);
  el<HTMLInputElement>('set-def-thickness').value = String(settings.defaultThickness);
  el<HTMLSelectElement>('set-def-material').value = settings.defaultMaterial;
  el<HTMLInputElement>('set-edgeband').checked = settings.edgeBanding;
  el<HTMLInputElement>('set-edgeband-th').value = String(settings.edgeBandingThickness);
  el<HTMLInputElement>('set-autoassemble').checked = settings.autoAssemble;
  el<HTMLInputElement>('set-showgrid').checked = settings.showGrid;
  el<HTMLSelectElement>('set-bg').value = settings.background;
  el('settings-status').textContent = '';
  el('settings-backdrop').hidden = false;
}

el('btn-settings').addEventListener('click', openSettings);
el('btn-settings-close').addEventListener('click', () => {
  el('settings-backdrop').hidden = true;
});
el('settings-backdrop').addEventListener('click', (e) => {
  if (e.target === el('settings-backdrop')) el('settings-backdrop').hidden = true;
});

el<HTMLButtonElement>('btn-settings-save').addEventListener('click', () => {
  settings = {
    erpEndpoint: el<HTMLInputElement>('set-erp-endpoint').value.trim(),
    erpApiKey: el<HTMLInputElement>('set-erp-key').value.trim(),
    catalogAutoSync: el<HTMLInputElement>('set-cat-autosync').checked,
    gridSnap: Math.max(0, Number(el<HTMLInputElement>('set-grid').value) || 0),
    snapToPart: el<HTMLInputElement>('set-snap-part').checked,
    sheetLength: Number(el<HTMLInputElement>('set-sheet-l').value) || 2800,
    sheetWidth: Number(el<HTMLInputElement>('set-sheet-w').value) || 2070,
    kerf: Number(el<HTMLInputElement>('set-kerf').value) || 4,
    trim: Number(el<HTMLInputElement>('set-trim').value) || 10,
    defaultThickness: Number(el<HTMLInputElement>('set-def-thickness').value) || 18,
    defaultMaterial: el<HTMLSelectElement>('set-def-material').value,
    edgeBanding: el<HTMLInputElement>('set-edgeband').checked,
    edgeBandingThickness: Number(el<HTMLInputElement>('set-edgeband-th').value) || 1,
    autoAssemble: el<HTMLInputElement>('set-autoassemble').checked,
    showGrid: el<HTMLInputElement>('set-showgrid').checked,
    background: el<HTMLSelectElement>('set-bg').value as AppSettings['background'],
  };
  saveSettings(settings);
  viewer.setSnapOptions(settings.gridSnap, settings.snapToPart);
  viewer.setGridVisible(settings.showGrid);
  viewer.setBackground(settings.background);
  renderCutlist();
  setStatus('settings-status', 'Einstellungen gespeichert.', true);
});

// ------------------------------------------------------- 2D-Skizze (✏)
// Frontansicht-Skizze mit Pan/Zoom (Rad, mittlere/rechte Maustaste),
// DPR-scharfem Rendering, adaptivem Raster, Kanten-/Rasterfang sowie
// Auswahl und Löschen gezeichneter Rechtecke — flüssig auch bei grossen
// Skizzen (rAF-gebündeltes Neuzeichnen, gecachte Fangkanten).

interface SketchRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const SK_W = 1160;
const SK_H = 660;
// Skizzenebenen: h = waagrechte Achse, v = senkrechte Achse, n = Normale (Lage)
type SketchPlane = 'front' | 'side' | 'top';
const PLANES: Record<SketchPlane, { h: 0 | 1 | 2; v: 0 | 1 | 2; n: 0 | 1 | 2; title: string; offLabel: string }> = {
  front: { h: 0, v: 1, n: 2, title: 'Front (XY)', offLabel: 'Z-Lage' },
  side: { h: 2, v: 1, n: 0, title: 'Seite (ZY)', offLabel: 'X-Lage' },
  top: { h: 0, v: 2, n: 1, title: 'Oben (XZ)', offLabel: 'Y-Lage' },
};
let skPlane: SketchPlane = 'front';
const sketchCanvas = el<HTMLCanvasElement>('sketch-canvas');
let sketchRects: SketchRect[] = [];
let sketchDrag: { x0: number; y0: number; x1: number; y1: number } | null = null;
let sketchPan: { px: number; py: number } | null = null;
let sketchSelected = -1;
let sketchDown: { px: number; py: number } | null = null;
let skView = { scale: 0.3, ox: SK_W / 2, oy: SK_H / 2 };
let skEdges: { xs: number[]; ys: number[] } = { xs: [], ys: [] };
let skDrawQueued = false;

function skSyncDataset(): void {
  sketchCanvas.dataset.scale = String(skView.scale);
  sketchCanvas.dataset.cx = String(skView.ox);
  sketchCanvas.dataset.cy = String(skView.oy);
}

/** Kanten aller Bauteile in der aktuellen Projektionsebene (Kantenfang, gecacht) */
function skCacheEdges(): void {
  const { h, v } = PLANES[skPlane];
  const xs: number[] = [];
  const ys: number[] = [];
  for (const part of assembly.parts) {
    if (part.shape !== 'box') continue;
    xs.push(part.position[h] - part.size[h] / 2, part.position[h] + part.size[h] / 2);
    ys.push(part.position[v] - part.size[v] / 2, part.position[v] + part.size[v] / 2);
  }
  skEdges = { xs, ys };
}

function sketchToModel(px: number, py: number): [number, number] {
  return [(px - skView.ox) / skView.scale, (skView.oy - py) / skView.scale];
}

function modelToSketch(x: number, y: number): [number, number] {
  return [skView.ox + x * skView.scale, skView.oy - y * skView.scale];
}

function scheduleSketchDraw(): void {
  if (skDrawQueued) return;
  skDrawQueued = true;
  requestAnimationFrame(() => {
    skDrawQueued = false;
    drawSketch();
  });
}

function drawSketch(): void {
  const ctx = sketchCanvas.getContext('2d')!;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, SK_W, SK_H);

  // Adaptives Raster: Schrittweite so wählen, dass Linien >= 9 px auseinander liegen
  let grid = 50;
  while (grid * skView.scale < 9) grid *= 2;
  const [minX, maxY] = sketchToModel(0, 0);
  const [maxX, minY] = sketchToModel(SK_W, SK_H);
  ctx.lineWidth = 1;
  for (let gx = Math.ceil(minX / grid) * grid; gx <= maxX; gx += grid) {
    const [px] = modelToSketch(gx, 0);
    ctx.strokeStyle = gx % (grid * 4) === 0 ? '#d0d7dd' : '#eef1f4';
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, SK_H);
    ctx.stroke();
  }
  for (let gy = Math.ceil(minY / grid) * grid; gy <= maxY; gy += grid) {
    const [, py] = modelToSketch(0, gy);
    ctx.strokeStyle = gy % (grid * 4) === 0 ? '#d0d7dd' : '#eef1f4';
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(SK_W, py);
    ctx.stroke();
  }
  // Achsen durch den Ursprung
  ctx.strokeStyle = '#b9c3cc';
  const [ax, ay] = modelToSketch(0, 0);
  ctx.beginPath(); ctx.moveTo(ax, 0); ctx.lineTo(ax, SK_H); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, ay); ctx.lineTo(SK_W, ay); ctx.stroke();

  // Bestehende Bauteile (aktuelle Projektionsebene, hinten zuerst)
  const { h, v, n } = PLANES[skPlane];
  const sorted = [...assembly.parts].filter((p) => p.shape === 'box').sort((a, b) => a.position[n] - b.position[n]);
  for (const part of sorted) {
    const [px, py] = modelToSketch(part.position[h] - part.size[h] / 2, part.position[v] + part.size[v] / 2);
    ctx.fillStyle = 'rgba(217, 185, 140, 0.55)';
    ctx.strokeStyle = '#8a6537';
    ctx.lineWidth = 1;
    ctx.fillRect(px, py, part.size[h] * skView.scale, part.size[v] * skView.scale);
    ctx.strokeRect(px, py, part.size[h] * skView.scale, part.size[v] * skView.scale);
  }

  // Gezeichnete Rechtecke (Auswahl hervorgehoben)
  sketchRects.forEach((r, i) => {
    const [px, py] = modelToSketch(r.x, r.y + r.h);
    const selected = i === sketchSelected;
    ctx.fillStyle = selected ? 'rgba(247, 148, 30, 0.3)' : 'rgba(6, 150, 215, 0.25)';
    ctx.strokeStyle = selected ? '#f7941e' : '#0696d7';
    ctx.lineWidth = 2;
    ctx.fillRect(px, py, r.w * skView.scale, r.h * skView.scale);
    ctx.strokeRect(px, py, r.w * skView.scale, r.h * skView.scale);
    if (r.w * skView.scale > 46) {
      ctx.fillStyle = '#1c2b4a';
      ctx.font = '11px sans-serif';
      ctx.fillText(`${r.w} × ${r.h}`, px + 4, py + 14);
    }
  });

  // Aktueller Zug (gestrichelt) mit Live-Mass
  if (sketchDrag) {
    const x = Math.min(sketchDrag.x0, sketchDrag.x1);
    const y = Math.max(sketchDrag.y0, sketchDrag.y1);
    const w = Math.abs(sketchDrag.x1 - sketchDrag.x0);
    const hgt = Math.abs(sketchDrag.y1 - sketchDrag.y0);
    const [px, py] = modelToSketch(x, y);
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = '#f7941e';
    ctx.lineWidth = 2;
    ctx.strokeRect(px, py, w * skView.scale, hgt * skView.scale);
    ctx.setLineDash([]);
    ctx.fillStyle = '#c05f00';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(`${w} × ${hgt} mm`, px + 4, py - 6);
  }

  el('sk-status').textContent =
    `${sketchRects.length} Rechteck(e)` +
    (sketchSelected >= 0 ? ' · 1 ausgewählt (Entf löscht)' : '') +
    ` — Zoom ${(skView.scale * 100).toFixed(0)} % · Raster ${settings.gridSnap || '–'} mm · Kantenfang ${settings.snapToPart ? 'an' : 'aus'} · Rad = Zoom, rechte/mittlere Taste = Verschieben`;
}

function skCssPoint(e: MouseEvent): [number, number] {
  const rect = sketchCanvas.getBoundingClientRect();
  return [((e.clientX - rect.left) / rect.width) * SK_W, ((e.clientY - rect.top) / rect.height) * SK_H];
}

function snappedSketchPoint(e: MouseEvent): [number, number] {
  const [px, py] = skCssPoint(e);
  const [rawX, rawY] = sketchToModel(px, py);
  const grid = settings.gridSnap > 0 ? Math.max(settings.gridSnap, 10) : 10;
  const edges = settings.snapToPart ? skEdges : { xs: [], ys: [] };
  const tol = 8 / skView.scale;
  return [snapValue(rawX, edges.xs, grid, tol), snapValue(rawY, edges.ys, grid, tol)];
}

function skFit(): void {
  const dim = [assembly.overall.width, assembly.overall.height, assembly.overall.depth];
  const { h, v } = PLANES[skPlane];
  const extent = Math.max(dim[h], dim[v]) + 500;
  skView.scale = Math.min((SK_W - 60) / extent, (SK_H - 60) / extent);
  skView.ox = SK_W / 2;
  skView.oy = SK_H / 2;
  skSyncDataset();
  scheduleSketchDraw();
}

/** Titel, Lage-Beschriftung und Kanten an die gewählte Ebene anpassen */
function skUpdatePlane(): void {
  const plane = PLANES[skPlane];
  el('sk-title').textContent = `2D-Skizze — ${plane.title}`;
  el('sk-off-field').firstChild!.textContent = `${plane.offLabel} `;
  skCacheEdges();
  skFit();
}

function openSketch(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  sketchCanvas.style.width = `${SK_W}px`;
  sketchCanvas.style.height = `${SK_H}px`;
  sketchCanvas.width = SK_W * dpr;
  sketchCanvas.height = SK_H * dpr;
  sketchRects = [];
  sketchDrag = null;
  sketchSelected = -1;
  el<HTMLInputElement>('sk-thickness').value = String(params.thickness);
  const dim = [assembly.overall.width, assembly.overall.height, assembly.overall.depth];
  el<HTMLInputElement>('sk-z').value = String(Math.round(dim[PLANES[skPlane].n] / 2 + 40));
  el('sketch-backdrop').hidden = false;
  skUpdatePlane();
}

el('btn-sketch').addEventListener('click', openSketch);
el<HTMLSelectElement>('sk-plane').addEventListener('change', () => {
  skPlane = el<HTMLSelectElement>('sk-plane').value as SketchPlane;
  const dim = [assembly.overall.width, assembly.overall.height, assembly.overall.depth];
  el<HTMLInputElement>('sk-z').value = String(Math.round(dim[PLANES[skPlane].n] / 2 + 40));
  sketchRects = [];
  sketchSelected = -1;
  skUpdatePlane();
});
el('btn-sk-close').addEventListener('click', () => {
  el('sketch-backdrop').hidden = true;
});
el('btn-sk-fit').addEventListener('click', skFit);
el('btn-sk-undo').addEventListener('click', () => {
  sketchRects.pop();
  sketchSelected = -1;
  scheduleSketchDraw();
});

function skDeleteSelected(): void {
  if (sketchSelected < 0) return;
  sketchRects.splice(sketchSelected, 1);
  sketchSelected = -1;
  scheduleSketchDraw();
}
el('btn-sk-delete').addEventListener('click', skDeleteSelected);

window.addEventListener('keydown', (e) => {
  if (el<HTMLElement>('sketch-backdrop').hidden) return;
  if (e.key === 'Delete' || e.key === 'Backspace') skDeleteSelected();
  if (e.key === 'Escape') {
    if (sketchDrag) {
      sketchDrag = null;
      scheduleSketchDraw();
    } else {
      el('sketch-backdrop').hidden = true;
    }
  }
});

sketchCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

sketchCanvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const [px, py] = skCssPoint(e);
  const factor = Math.pow(1.0015, -e.deltaY);
  const next = Math.min(4, Math.max(0.02, skView.scale * factor));
  const k = next / skView.scale;
  skView.ox = px - (px - skView.ox) * k;
  skView.oy = py - (py - skView.oy) * k;
  skView.scale = next;
  skSyncDataset();
  scheduleSketchDraw();
}, { passive: false });

sketchCanvas.addEventListener('mousedown', (e) => {
  const [px, py] = skCssPoint(e);
  if (e.button === 1 || e.button === 2 || e.shiftKey) {
    sketchPan = { px, py };
    return;
  }
  sketchDown = { px, py };
  const [x, y] = snappedSketchPoint(e);
  sketchDrag = { x0: x, y0: y, x1: x, y1: y };
  scheduleSketchDraw();
});

sketchCanvas.addEventListener('mousemove', (e) => {
  const [px, py] = skCssPoint(e);
  if (sketchPan) {
    skView.ox += px - sketchPan.px;
    skView.oy += py - sketchPan.py;
    sketchPan = { px, py };
    skSyncDataset();
    scheduleSketchDraw();
    return;
  }
  if (!sketchDrag) return;
  const [x, y] = snappedSketchPoint(e);
  sketchDrag.x1 = x;
  sketchDrag.y1 = y;
  scheduleSketchDraw();
});

sketchCanvas.addEventListener('mouseup', (e) => {
  if (sketchPan) {
    sketchPan = null;
    return;
  }
  if (!sketchDrag) return;
  const moved = sketchDown
    ? Math.hypot(skCssPoint(e)[0] - sketchDown.px, skCssPoint(e)[1] - sketchDown.py)
    : 99;
  const x = Math.min(sketchDrag.x0, sketchDrag.x1);
  const y = Math.min(sketchDrag.y0, sketchDrag.y1);
  const w = Math.abs(sketchDrag.x1 - sketchDrag.x0);
  const h = Math.abs(sketchDrag.y1 - sketchDrag.y0);
  sketchDrag = null;
  sketchDown = null;
  if (moved < 4) {
    // Klick: Rechteck unter dem Mauszeiger auswählen
    const [mx, my] = sketchToModel(...skCssPoint(e));
    sketchSelected = -1;
    for (let i = sketchRects.length - 1; i >= 0; i--) {
      const r = sketchRects[i];
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
        sketchSelected = i;
        break;
      }
    }
  } else if (w >= 20 && h >= 20) {
    sketchRects.push({ x, y, w, h });
    sketchSelected = -1;
  }
  scheduleSketchDraw();
});

el<HTMLButtonElement>('btn-sk-apply').addEventListener('click', () => {
  const thickness = Number(el<HTMLInputElement>('sk-thickness').value) || params.thickness;
  const off = Number(el<HTMLInputElement>('sk-z').value) || 0;
  const { h, v, n } = PLANES[skPlane];
  overrides.additions ??= [];
  let nr = overrides.additions.length;
  for (const r of sketchRects) {
    nr++;
    const size: [number, number, number] = [0, 0, 0];
    const position: [number, number, number] = [0, 0, 0];
    size[h] = r.w; size[v] = r.h; size[n] = thickness;
    position[h] = r.x + r.w / 2; position[v] = r.y + r.h / 2; position[n] = off;
    overrides.additions.push({
      id: `sketch-${crypto.randomUUID()}`,
      name: `Skizzenbrett ${nr}`,
      shape: 'box',
      size,
      position,
      materialKey: 'current',
    });
  }
  el('sketch-backdrop').hidden = true;
  if (sketchRects.length > 0) rebuild();
});


// --------------------------------------------------- Bauteil-Katalog einfügen

function insertCatalogPart(key: string): void {
  const catalogPart = PARTS_CATALOG.find((p) => p.key === key);
  if (!catalogPart) return;
  const added = instantiateCatalogPart(catalogPart, [0, 0, assembly.overall.depth / 2 + 120]);
  overrides.additions ??= [];
  overrides.additions.push(added);
  rebuild();
  viewer.selectPart(added.id);
}

function renderPartsCatalog(): void {
  const list = el('parts-catalog');
  list.innerHTML = '';
  for (const part of PARTS_CATALOG) {
    const row = document.createElement('div');
    row.className = 'cat-part';
    row.dataset.catalogKey = part.key;
    row.draggable = true;
    row.title = 'Einfügen (Klick oder in die 3D-Ansicht ziehen)';
    const name = document.createElement('span');
    name.textContent = part.name;
    const desc = document.createElement('span');
    desc.className = 'cp-desc';
    desc.textContent = part.description;
    row.append(name, desc);
    row.addEventListener('click', () => insertCatalogPart(part.key));
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('application/x-catalog-part', part.key);
    });
    list.appendChild(row);
  }
}
renderPartsCatalog();

const viewportEl = el('viewport');
viewportEl.addEventListener('dragover', (e) => {
  if (e.dataTransfer?.types.includes('application/x-catalog-part')) e.preventDefault();
});
viewportEl.addEventListener('drop', (e) => {
  const key = e.dataTransfer?.getData('application/x-catalog-part');
  if (!key) return;
  e.preventDefault();
  insertCatalogPart(key);
});

// ------------------------------------------- Modellieren (Extrude/Bohrung/Fase)

function selectedPart(): PartSpec | undefined {
  return selectedPartId ? assembly.parts.find((p) => p.id === selectedPartId) : undefined;
}

function toast(message: string): void {
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = message;
  document.body.appendChild(node);
  window.setTimeout(() => node.remove(), 2400);
}

// Extrudieren: 2D-Profil skizzieren und zu Bauteilen extrudieren
el('btn-extrude').addEventListener('click', openSketch);

// Bohrung: Durchgangsbohrung in das ausgewählte Plattenteil (dünnste Achse)
el('btn-hole').addEventListener('click', () => {
  const part = selectedPart();
  if (!part || part.shape !== 'box') {
    toast('Zuerst eine Platte auswählen, dann Bohrung setzen.');
    return;
  }
  const thin = part.size.indexOf(Math.min(...part.size));
  const axis = (['x', 'y', 'z'] as const)[thin];
  const d = 8;
  overrides.additions ??= [];
  overrides.additions.push({
    id: `hole-${crypto.randomUUID()}`,
    name: `Bohrung ø${d}`,
    shape: 'cylinder',
    size: [d, part.size[thin] + 2, d],
    axis,
    position: [...part.position] as [number, number, number],
    materialKey: 'bore',
  });
  rebuild();
  toast(`Bohrung ø${d} mm in «${part.name}» gesetzt.`);
});

// Fase: Kante des ausgewählten Bauteils brechen (Umschalten)
el('btn-chamfer').addEventListener('click', () => {
  const part = selectedPart();
  if (!part || part.shape !== 'box') {
    toast('Zuerst ein Bauteil auswählen, dann Kante brechen.');
    return;
  }
  const id = part.id;
  const already = overrides.parts[id]?.chamfer;
  if (already) delete partOverride(id).chamfer;
  else partOverride(id).chamfer = 3;
  rebuild();
  viewer.selectPart(id);
  toast(already ? 'Kante zurückgesetzt (scharf).' : 'Kante gebrochen (Fase r3 mm).');
});

// ---------------------------------------------- 3D-Bewegen (Gizmo) & Auto-Sync

el<HTMLInputElement>('move-mode').addEventListener('change', () => {
  viewer.setMoveMode(el<HTMLInputElement>('move-mode').checked);
});
viewer.setSnapOptions(settings.gridSnap, settings.snapToPart);
viewer.setGridVisible(settings.showGrid);
viewer.setBackground(settings.background);

if (settings.catalogAutoSync) {
  void autoSyncCatalogs().then((results) => {
    if (results.length === 0) return;
    const summary = results
      .map((r) => `${r.vendor}: ${r.ok ? 'aktualisiert (' + r.message + ')' : 'Fehler — ' + r.message}`)
      .join(' · ');
    populateHardwareSelects();
    renderCatalogList();
    setStatus('cat-status', `Auto-Update: ${summary}`, results.every((r) => r.ok));
  });
}

// ------------------------------------------------------------------ Start

rebuild();
viewer.setView('iso');

// Kleine Eröffnung: die Baugruppe setzt sich beim ersten Laden selbst zusammen.
if (settings.autoAssemble) {
  window.setTimeout(() => {
    if (!viewer.isAnimating) startAnimation();
  }, 700);
}
