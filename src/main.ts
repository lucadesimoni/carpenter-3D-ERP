// UI-Verdrahtung: Parameter → Baugruppe → Viewer, Browser-Baum,
// Zeitleiste, Prüfwerkzeuge (Messen/Schnitt/Bemassung) und Stückliste.

import './style.css';
import { buildCabinet, clampParams, DEFAULT_PARAMS } from './core/cabinet';
import { buildCutlist, cutlistToCsv, totalArea } from './core/cutlist';
import { buildDrawingSvg } from './core/drawing';
import { HANDLE_CATALOG, HANGER, HINGE_CATALOG, hingeCount, SHELF_PIN } from './core/hardware';
import { buildCutplanDxf, buildCutplanSvg, nestParts } from './core/nesting';
import { WOODS } from './core/wood';
import { Viewer, type SectionAxis, type ViewPreset } from './viewer/viewer';
import type { Assembly, CabinetParams, HardwareOptions, PartSpec } from './core/types';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Element #${id} fehlt`);
  return node as T;
}

const inputs = {
  width: el<HTMLInputElement>('p-width'),
  height: el<HTMLInputElement>('p-height'),
  depth: el<HTMLInputElement>('p-depth'),
  thickness: el<HTMLSelectElement>('p-thickness'),
  shelves: el<HTMLInputElement>('p-shelves'),
  door: el<HTMLInputElement>('p-door'),
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

let params: CabinetParams = { ...DEFAULT_PARAMS };
let assembly: Assembly;

const explodeSlider = el<HTMLInputElement>('explode');
const animButton = el<HTMLButtonElement>('btn-anim');
const dimsCheckbox = el<HTMLInputElement>('dims');
const measureCheckbox = el<HTMLInputElement>('measure');
const sectionOn = el<HTMLInputElement>('section-on');
const sectionAxis = el<HTMLSelectElement>('section-axis');
const sectionPos = el<HTMLInputElement>('section-pos');
const orthoCheckbox = el<HTMLInputElement>('ortho');
const scrub = el<HTMLInputElement>('tl-scrub');

const STEP_NAMES = ['Boden', 'Dübel', 'Seiten', 'Deckel', 'Rückwand', 'Böden', 'Front'];

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
    width: Number(inputs.width.value) || DEFAULT_PARAMS.width,
    height: Number(inputs.height.value) || DEFAULT_PARAMS.height,
    depth: Number(inputs.depth.value) || DEFAULT_PARAMS.depth,
    thickness: Number(inputs.thickness.value),
    shelves: Number(inputs.shelves.value) || 0,
    door: inputs.door.checked,
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
  assembly = buildCabinet(params);
  viewer.setAssembly(assembly);
  viewer.setExplode(Number(explodeSlider.value) / 100);
  applySection();
  renderTree();
  renderTimeline();
  renderCutlist();
  renderStatus();
  el('doc-name').textContent =
    `Hängeschrank v1 — ${params.width} × ${params.height} × ${params.depth} mm`;
  el('hw-note').textContent =
    params.door && params.hardware.hinge !== 'none'
      ? `${hingeCount(params.height - 4)} Scharniere bei Türhöhe ${params.height - 4} mm (Bohrbild System 32).`
      : 'Ohne Tür entfallen Scharniere und Griff.';
}

// ---------------------------------------------------------- Browser-Baum

const TREE_GROUPS: [string, string[]][] = [
  ['Korpus', ['Seite', 'Korpusboden', 'Korpusdeckel']],
  ['Rückwand', ['Rückwand']],
  ['Ausstattung', ['Einlegeboden']],
  ['Front', ['Tür']],
  [
    'Beschläge',
    [
      HINGE_CATALOG.clip110.label,
      HINGE_CATALOG.wide155.label,
      'Scharnier-Montageplatte',
      HANDLE_CATALOG.bar.label,
      HANDLE_CATALOG.knob.label,
      SHELF_PIN.label,
      HANGER.label,
    ],
  ],
  ['Verbindungen', ['Holzdübel']],
];

function renderTree(): void {
  const tree = el('tree');
  tree.innerHTML = '';
  for (const [category, groupKeys] of TREE_GROUPS) {
    const parts = assembly.parts.filter((p) => groupKeys.includes(p.groupKey));
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
    btn.title = `Stufe ${s}: ${STEP_NAMES[s - 1] ?? ''}`;
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
      : `Stufe ${step}/${assembly.stepCount}: ${STEP_NAMES[step - 1] ?? ''}`;
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
  a.download = `stueckliste-haengeschrank-${params.width}x${params.height}x${params.depth}.csv`;
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
  bad: { width: 400, height: 600, depth: 250, shelves: 1, door: true },
  kueche: { width: 800, height: 600, depth: 320, shelves: 2, door: true },
  regal: { width: 1200, height: 900, depth: 300, shelves: 3, door: false },
};
for (const chip of document.querySelectorAll<HTMLButtonElement>('[data-preset]')) {
  chip.addEventListener('click', () => {
    const preset = PRESETS[chip.dataset.preset!];
    if (!preset) return;
    if (preset.width !== undefined) inputs.width.value = String(preset.width);
    if (preset.height !== undefined) inputs.height.value = String(preset.height);
    if (preset.depth !== undefined) inputs.depth.value = String(preset.depth);
    if (preset.shelves !== undefined) inputs.shelves.value = String(preset.shelves);
    if (preset.door !== undefined) inputs.door.checked = preset.door;
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
    ? buildDrawingSvg(assembly, params)
    : buildCutplanSvg(nestParts(assembly));
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
  downloadBlob(dialogSvg(), 'image/svg+xml', `${name}-${params.width}x${params.height}x${params.depth}.svg`);
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
    downloadBlob(buffer, 'model/gltf-binary', `haengeschrank-${params.width}x${params.height}x${params.depth}.glb`);
  });
});

// ------------------------------------------------------------------ Start

rebuild();
viewer.setView('iso');

// Kleine Eröffnung: die Baugruppe setzt sich beim ersten Laden selbst zusammen.
window.setTimeout(() => {
  if (!viewer.isAnimating) startAnimation();
}, 700);
