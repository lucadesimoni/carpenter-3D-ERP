// UI-Verdrahtung: Parameter → Baugruppe → Viewer, Browser-Baum,
// Zeitleiste, Prüfwerkzeuge, Stückliste/BOM und Herstellerkataloge.

import './style.css';
import { buildBom, syncBom } from './core/bom';
import { DEFAULT_PARAMS } from './core/cabinet';
import { assemblySlug, buildFurniture, clampParams, FURNITURE_TYPES } from './core/furniture';
import {
  addCatalog,
  applyStoredCatalogs,
  fetchCatalog,
  loadStoredCatalogs,
  removeCatalog,
  validateCatalog,
} from './core/catalog';
import { buildCutlist, cutlistToCsv, totalArea } from './core/cutlist';
import { buildDrawingBundleSvg, buildDrawingSheets } from './core/drawing';
import { hingeCount, listHandles, listHinges } from './core/hardware';
import { buildCutplanDxf, buildCutplanSvg, nestParts } from './core/nesting';
import { buildPartsDxf } from './core/partdxf';
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
import type { Assembly, CabinetParams, FurnitureType, HardwareOptions, PartSpec } from './core/types';

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

let params: CabinetParams = { ...DEFAULT_PARAMS };
let assembly: Assembly;
/** Anzeigename des aktuellen Dokuments (Projekt/Vorlage) + Versionsstand */
let docLabel: string | null = null;
let docVersion: number | null = null;

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
  assembly = buildFurniture(params);
  viewer.setAssembly(assembly);
  viewer.setExplode(Number(explodeSlider.value) / 100);
  applySection();
  renderTree();
  renderTimeline();
  renderCutlist();
  renderStatus();
  el('doc-name').textContent =
    `${docLabel ?? assembly.name}${docVersion ? ` v${docVersion}` : ''} — ${params.width} × ${params.height} × ${params.depth} mm`;
  applyTypeUi();
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
  for (const [category, match] of TREE_GROUPS) {
    const parts = assembly.parts.filter(match);
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
        viewer.setPartVisible(part.id, nowVisible);
      });

      const name = document.createElement('span');
      name.textContent = part.name;
      row.addEventListener('click', () => viewer.selectPart(part.id));

      row.append(eye, name);
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
    part.materialKey === 'metal' ? 'Edelstahl' : WOODS[part.materialKey]?.label ?? part.materialKey;
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
    : buildCutplanSvg(nestParts(assembly));
}

function dialogDownloadSvg(): string {
  return dialogTab === 'drawing' ? buildDrawingBundleSvg(assembly, params) : buildCutplanSvg(nestParts(assembly));
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
    buildCutplanDxf(nestParts(assembly)),
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
function applyParams(p: CabinetParams, label: string | null, version: number | null): void {
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
  rebuild();
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
        applyParams(blank.params, null, null);
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
          applyParams(latest.params, project.name, latest.version);
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
el('btn-home-ribbon').addEventListener('click', openHome);
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
      applyParams(latest.params, project.name, latest.version);
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
        applyParams(v.params, project.name, v.version);
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
  const { version } = saveVersion(name, params);
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

const ENDPOINT_KEY = 'schreinercad.bomEndpoint';
el<HTMLInputElement>('bom-endpoint').value = localStorage.getItem(ENDPOINT_KEY) ?? '';

el<HTMLButtonElement>('btn-bom-json').addEventListener('click', () => {
  const bom = buildBom(assembly, params);
  downloadBlob(JSON.stringify(bom, null, 2), 'application/json', `${bom.document}-bom.json`);
});

el<HTMLButtonElement>('btn-bom-sync').addEventListener('click', () => {
  const endpoint = el<HTMLInputElement>('bom-endpoint').value.trim();
  if (!endpoint) {
    setStatus('bom-status', 'Bitte ERP-Endpunkt angeben.', false);
    return;
  }
  localStorage.setItem(ENDPOINT_KEY, endpoint);
  const apiKey = el<HTMLInputElement>('bom-apikey').value.trim() || undefined;
  const button = el<HTMLButtonElement>('btn-bom-sync');
  button.disabled = true;
  setStatus('bom-status', 'Übertrage …', true);
  void syncBom(buildBom(assembly, params), endpoint, apiKey).then((result) => {
    button.disabled = false;
    setStatus('bom-status', result.message, result.ok);
  });
});

// ------------------------------------------------------------------ Start

rebuild();
viewer.setView('iso');

// Kleine Eröffnung: die Baugruppe setzt sich beim ersten Laden selbst zusammen.
window.setTimeout(() => {
  if (!viewer.isAnimating) startAnimation();
}, 700);
