// E2E-Smoke-Test für SchreinerCAD (Playwright + Chromium, headless).
//
// Aufruf:  npm run build && npm run test:e2e
// Der Test startet selbst einen `vite preview`-Server auf einem freien Port,
// fährt die komplette Oberfläche durch und beendet sich mit Exit-Code 0/1.
//
// Optional: CHROMIUM_PATH=/pfad/zu/chrome, falls die von Playwright
// heruntergeladenen Browser nicht verfügbar sind.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import { chromium } from 'playwright';

const root = new URL('..', import.meta.url).pathname;

async function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForServer(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* Server noch nicht bereit */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Preview-Server unter ${url} nicht erreichbar`);
}

if (!fs.existsSync(root + 'dist/index.html')) {
  console.error('dist/ fehlt — zuerst `npm run build` ausführen.');
  process.exit(1);
}

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
  cwd: root,
  stdio: 'ignore',
});
process.on('exit', () => server.kill());
await waitForServer(base);

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✔ ${name}`); }
  else { fail++; console.log(`  ✘ ${name} ${detail}`); }
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// Inspector-Tab aktivieren (Entwurf/Bauteil/Verlauf/Liste/Projekte)
const showTab = async (name) => {
  await page.locator(`.insp-tab[data-insp-tab="${name}"]`).click();
  await page.waitForTimeout(80);
};

const errors = [];
page.on('console', (m) => {
  // Der ERP-Fehlerfall-Test provoziert absichtlich ein HTTP 500 — nicht zählen.
  if (m.type() === 'error' && !(m.location()?.url ?? '').includes('erp-down')) errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(base, { waitUntil: 'networkidle' });

console.log('— Start & Intro —');
check('Canvas vorhanden', (await page.locator('#viewport > canvas').count()) === 1);
await page.waitForTimeout(1500);
check('Intro-Animation läuft', (await page.locator('#btn-anim').textContent()).includes('Stopp'));
await page.waitForFunction(() => !document.querySelector('#explode').disabled, { timeout: 12000 });
check('Intro-Animation endet von selbst', true);

console.log('— Standardmodell (800×600×320, 2 Böden, Tür) —');
check('35 Bauteile', (await page.locator('#status-parts').textContent()).trim() === '35 Bauteile');
check('12 Stücklisten-Positionen', (await page.locator('#cutlist tbody tr').count()) === 12);
const cutlistText = await page.locator('#cutlist').textContent();
check('Stückliste nennt Scharnier-System', cutlistText.includes('Blum Clip top'), cutlistText.slice(0, 200));
const area = await page.locator('#area-total').textContent();
check('Plattenbedarf angezeigt', /Plattenbedarf gesamt: \d+\.\d{2} m²/.test(area), area);

console.log('— CSV-Export —');
await showTab('liste');
const [csvDl] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('#btn-csv').click(),
]);
const csv = fs.readFileSync(await csvDl.path(), 'utf-8');
check('CSV-Dateiname', csvDl.suggestedFilename() === 'stueckliste-haengeschrank-800x600x320.csv', csvDl.suggestedFilename());
check('CSV-Header', csv.includes('Pos;Bezeichnung;Anzahl;Masse (mm);Material'));
check('CSV: Seiten 2 Stk', /Seite;2;600 × 320 × 18;Eiche furniert/.test(csv));
check('CSV: 12 Dübel', /Holzdübel;12;ø8 × 40;/.test(csv));
check('CSV: Rückwand HDF', /Rückwand;1;576 × 776 × 8;HDF natur/.test(csv));

console.log('— PNG-Export —');
const [pngDl] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('#btn-screenshot').click(),
]);
const pngBuf = fs.readFileSync(await pngDl.path());
check('PNG-Signatur', pngBuf.subarray(1, 4).toString() === 'PNG' && pngBuf.length > 50000, `${pngBuf.length} bytes`);

console.log('— Parameter-Clamping —');
await showTab('entwurf');
await page.locator('#p-width').fill('5000');
await page.locator('#p-width').dispatchEvent('change');
await page.waitForTimeout(300);
check('Breite 5000 → 1600 geclampt', (await page.locator('#p-width').inputValue()) === '1600');
check('Status zeigt 1600', (await page.locator('#status-dims').textContent()).includes('1600'));
await page.locator('#p-height').fill('10');
await page.locator('#p-height').dispatchEvent('change');
await page.waitForTimeout(300);
check('Höhe 10 → 300 geclampt', (await page.locator('#p-height').inputValue()) === '300');

console.log('— Randkonfiguration: 0 Böden, keine Tür —');
await page.locator('[data-preset="kueche"]').click();
await page.waitForTimeout(300);
await page.locator('#p-shelves').fill('0');
await page.locator('#p-shelves').dispatchEvent('change');
await page.locator('#p-door').uncheck();
await page.waitForTimeout(400);
// 2 Seiten + Boden + Deckel + Rückwand + 12 Dübel + 2 Aufhänger = 19
check('19 Bauteile ohne Böden/Tür', (await page.locator('#status-parts').textContent()).trim() === '19 Bauteile');
check('Aussentiefe ohne Tür = 320', (await page.locator('#status-dims').textContent()).includes('800 × 600 × 320'));
await page.locator('#p-door').check();
await page.waitForTimeout(300);
check('Aussentiefe mit Tür = 338', (await page.locator('#status-dims').textContent()).includes('800 × 600 × 338'));

console.log('— Materialien durchschalten —');
for (const key of ['buche', 'nussbaum', 'fichte', 'mdf', 'eiche']) {
  await page.locator('#p-material').selectOption(key);
  await page.waitForTimeout(150);
}
check('Materialwechsel ohne Fehler', errors.length === 0);

console.log('— Explosion & Bemassung —');
await page.locator('[data-preset="kueche"]').click();
await page.waitForTimeout(300);
await page.locator('#explode').fill('100');
await page.locator('#explode').dispatchEvent('input');
await page.locator('#dims').check();
await page.waitForTimeout(300);
check('3 Masslabels sichtbar', (await page.locator('.dim-label:visible').count()) === 3);
const labels = (await page.locator('.dim-label').allTextContents()).join(',');
check('Masswerte korrekt', labels.includes('800 mm') && labels.includes('600 mm') && labels.includes('338 mm'), labels);
await page.locator('#dims').uncheck();
await page.waitForTimeout(200);
check('Bemassung ausblendbar', (await page.locator('.dim-label').count()) === 0);
await page.locator('#explode').fill('0');
await page.locator('#explode').dispatchEvent('input');

console.log('— Auswahl / Abwahl —');
const vbox = await page.locator('#viewport > canvas').boundingBox();
await page.locator('#viewport > canvas').click({
  position: { x: vbox.width * 0.5, y: vbox.height * 0.55 },
});
await page.waitForTimeout(200);
check('Bauteil ausgewählt', !(await page.locator('#part-info').isHidden()), await page.locator('#pi-name').textContent());
check('Stücklisten-Zeile markiert', (await page.locator('#cutlist tr.active').count()) === 1);
await page.locator('#viewport > canvas').click({ position: { x: 80, y: 80 } });
await page.waitForTimeout(200);
check('Klick ins Leere wählt ab', await page.locator('#part-info').isHidden());
check('Markierung entfernt', (await page.locator('#cutlist tr.active').count()) === 0);

console.log('— Kamera-Presets, ViewCube & Projektion —');
for (const v of ['front', 'side', 'top', 'iso']) {
  await page.locator(`[data-view="${v}"]`).click();
  await page.waitForTimeout(450); // Kamerafahrt abwarten
}
check('Presets ohne Fehler', errors.length === 0);
check('ViewCube vorhanden', (await page.locator('#viewcube canvas').count()) === 1);
await page.locator('#viewcube canvas').click({ position: { x: 48, y: 48 } });
await page.waitForTimeout(500);
check('ViewCube-Klick ohne Fehler', errors.length === 0);
await page.locator('#ortho').check();
await page.waitForTimeout(300);
check('Orthogonale Projektion ohne Fehler', errors.length === 0);
await page.locator('#ortho').uncheck();
await page.waitForTimeout(200);

console.log('— Browser-Baum —');
check('35 Baum-Einträge', (await page.locator('.tree-item').count()) === 35);
await page.locator('.tree-item[data-part-id="tuer"] .ti-name').click();
await page.waitForTimeout(200);
check('Baum-Klick wählt Tür aus', (await page.locator('#pi-name').textContent()) === 'Tür (aufschlagend)');
check('Baum-Zeile markiert', (await page.locator('.tree-item.selected').count()) === 1);
await page.locator('.tree-item[data-part-id="tuer"] .eye').click();
await page.waitForTimeout(200);
check('Auge blendet Tür aus', (await page.locator('.tree-item[data-part-id="tuer"] .eye').getAttribute('aria-pressed')) === 'false');
check('Ausblenden hebt Auswahl auf', await page.locator('#part-info').isHidden());
await page.locator('.tree-item[data-part-id="tuer"] .eye').click();
await page.waitForTimeout(200);
check('Auge blendet Tür wieder ein', (await page.locator('.tree-item[data-part-id="tuer"] .eye').getAttribute('aria-pressed')) === 'true');

console.log('— Zeitleiste —');
check('7 Stufen-Marker', (await page.locator('.tl-marker').count()) === 7);
await page.locator('.tl-marker').nth(2).click();
await page.waitForTimeout(200);
check('Stufe 3 aktiv', (await page.locator('#tl-state').textContent()).includes('Stufe 3/7'));
await page.locator('#tl-scrub').fill('7');
await page.locator('#tl-scrub').dispatchEvent('input');
await page.waitForTimeout(200);
check('Zeitleiste zurück auf komplett', (await page.locator('#tl-state').textContent()).trim() === 'komplett');

console.log('— Messen —');
await page.locator('[data-view="front"]').click();
await page.waitForTimeout(500);
await page.locator('#measure').check();
await page.waitForTimeout(100);
check('Mess-Hinweis sichtbar', await page.locator('#measure-hint').isVisible());
const canvas = page.locator('#viewport > canvas');
const box = await canvas.boundingBox();
await canvas.click({ position: { x: box.width * 0.4, y: box.height * 0.5 } });
await canvas.click({ position: { x: box.width * 0.6, y: box.height * 0.5 } });
await page.waitForTimeout(200);
const measureText = await page.locator('#measure-result').textContent();
check('Messergebnis mit Abstand', /Abstand: \d+(\.\d+)? mm/.test(measureText), measureText);
await page.locator('#measure').uncheck();
await page.waitForTimeout(100);
check('Messmodus beendet', (await page.locator('#measure-result').textContent()) === '');

console.log('— Schnittansicht —');
await page.locator('#section-on').check();
await page.waitForTimeout(200);
check('Schnitt aktiviert Regler', await page.locator('#section-pos').isEnabled());
await page.locator('#section-pos').fill('30');
await page.locator('#section-pos').dispatchEvent('input');
await page.locator('#section-axis').selectOption('x');
await page.waitForTimeout(300);
check('Schnitt X-Achse ohne Fehler', errors.length === 0);
await page.locator('#section-on').uncheck();
await page.waitForTimeout(200);
check('Schnitt deaktivierbar', !(await page.locator('#section-pos').isEnabled()));

console.log('— Animation —');
await page.locator('#btn-anim').click();
await page.waitForTimeout(800);
check('Animation gestartet', (await page.locator('#btn-anim').textContent()).includes('Stopp'));
check('Slider während Animation gesperrt', !(await page.locator('#explode').isEnabled()));
await page.locator('#btn-anim').click();
check('Animation stoppbar', (await page.locator('#btn-anim').textContent()).includes('Montage'));
check('Slider wieder frei', await page.locator('#explode').isEnabled());

console.log('— Beschläge-Bibliothek —');
await showTab('entwurf');
await page.locator('#hw-hinge').selectOption('none');
await page.waitForTimeout(300);
check('Ohne Scharniere 31 Bauteile', (await page.locator('#status-parts').textContent()).trim() === '31 Bauteile');
await page.locator('#hw-hinge').selectOption('wide155');
await page.waitForTimeout(300);
const cutlist155 = await page.locator('#cutlist').textContent();
check('155°-Scharnier in Stückliste', cutlist155.includes('Weitwinkelscharnier 155°'), cutlist155.slice(0, 160));
await page.locator('#hw-hinge').selectOption('clip110');
await page.locator('#hw-handle').selectOption('knob');
await page.waitForTimeout(300);
check('Möbelknopf in Stückliste', (await page.locator('#cutlist').textContent()).includes('Möbelknopf'));
await page.locator('#hw-handle').selectOption('bar');
await page.waitForTimeout(300);
check('Beschläge-Hinweis (Scharnierzahl)', /2 Scharniere/.test(await page.locator('#hw-note').textContent()));

console.log('— Werkzeichnung —');
await page.locator('#btn-drawing').click();
await page.waitForTimeout(300);
check('Zeichnungsdialog offen', await page.locator('#dialog').isVisible());
const drawingSvg = await page.locator('#dialog-body').innerHTML();
check('Ansichten vorhanden', drawingSvg.includes('Vorderansicht') && drawingSvg.includes('Seitenansicht') && drawingSvg.includes('Draufsicht'));
check('Massstab im Titelblock', /Massstab 1:\d+/.test(drawingSvg));
check('Breitenmass in Zeichnung', drawingSvg.includes('>800<'));
const [svgDl] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('#btn-dl-svg').click(),
]);
const svgFile = fs.readFileSync(await svgDl.path(), 'utf-8');
check('SVG-Download gültig', svgFile.startsWith('<svg') && svgFile.includes('Vorderansicht'), svgDl.suggestedFilename());

console.log('— Zuschnittplan —');
await page.locator('#tab-cutplan').click();
await page.waitForTimeout(300);
const cutplanSvg = await page.locator('#dialog-body').innerHTML();
check('Platte 1 im Plan', cutplanSvg.includes('Platte 1'));
check('Nutzungsgrad angegeben', /Nutzung \d+ %/.test(cutplanSvg));
const [dxfDl] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('#btn-dl-dxf').click(),
]);
const dxf = fs.readFileSync(await dxfDl.path(), 'utf-8');
check('DXF mit ENTITIES/LINE/TEXT', dxf.includes('ENTITIES') && dxf.includes('LINE') && dxf.includes('TEXT'));
check('DXF nennt Teile', dxf.includes('Seite links'));
await page.locator('#btn-dlg-close').click();
await page.waitForTimeout(200);
check('Dialog schliessbar', await page.locator('#dialog-backdrop').isHidden());

console.log('— GLB-Export —');
const [glbDl] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('#btn-glb').click(),
]);
const glb = fs.readFileSync(await glbDl.path());
check('GLB-Magic + Grösse', glb.subarray(0, 4).toString() === 'glTF' && glb.length > 20000, `${glb.length} bytes`);

console.log('— Herstellerkatalog: URL-Sync —');
await showTab('entwurf');
await page.locator('#cat-url').fill('catalogs/blum-beispiel.json');
await page.locator('#btn-cat-sync').click();
await page.waitForTimeout(400);
const catStatus = await page.locator('#cat-status').textContent();
check('Blum-Katalog synchronisiert', catStatus.includes('Blum') && catStatus.includes('3 Artikel'), catStatus);
check('Katalog in Liste', (await page.locator('.cat-entry[data-vendor="Blum"]').count()) === 1);
const hingeOptions = await page.locator('#hw-hinge option').allTextContents();
check('Katalog-Scharniere im Auswahlfeld', hingeOptions.some((o) => o.includes('Blumotion') && o.includes('[Blum]')), hingeOptions.join(' | '));
await page.locator('#hw-hinge').selectOption('Blum:cliptop-blumotion-110');
await page.waitForTimeout(300);
check('Katalog-Scharnier in Stückliste', (await page.locator('#cutlist').textContent()).includes('Blumotion'));

console.log('— Herstellerkatalog: Datei-Import —');
await page.locator('#cat-file').setInputFiles({
  name: 'haefele-test.json',
  mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify({
    schema: 'schreinercad-catalog/1',
    vendor: 'Häfele',
    note: 'Testdaten',
    items: [
      { kind: 'handle', key: 'bar-320', label: 'Griffstange ø12 × 320', vendor: 'Häfele Test, Edelstahl', style: 'bar', diameter: 12, length: 320 },
    ],
  })),
});
await page.waitForTimeout(400);
check('Datei-Import übernommen', (await page.locator('#cat-status').textContent()).includes('Häfele'));
await page.locator('#hw-handle').selectOption('Häfele:bar-320');
await page.waitForTimeout(300);
check('Katalog-Griff in Stückliste', (await page.locator('#cutlist').textContent()).includes('ø12 × 320'));

console.log('— Herstellerkatalog: entfernen & Validierung —');
await page.locator('.cat-entry[data-vendor="Blum"] .cat-remove').click();
await page.waitForTimeout(300);
check('Katalog entfernt', (await page.locator('.cat-entry[data-vendor="Blum"]').count()) === 0);
check('Auswahl fällt auf Standard zurück', (await page.locator('#hw-hinge').inputValue()) === 'clip110');
await page.locator('#cat-file').setInputFiles({
  name: 'kaputt.json',
  mimeType: 'application/json',
  buffer: Buffer.from('{"schema":"falsch"}'),
});
await page.waitForTimeout(300);
check('Fehlermeldung bei ungültigem Katalog', (await page.locator('#cat-status').textContent()).includes('fehlgeschlagen'));

console.log('— BOM-Export & ERP-Sync —');
await showTab('liste');
const [bomDl] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('#btn-bom-json').click(),
]);
const bom = JSON.parse(fs.readFileSync(await bomDl.path(), 'utf-8'));
check('BOM-Schema', bom.schema === 'schreinercad-bom/1');
check('BOM-Ereignis-ID (UUID)', /^[0-9a-f-]{36}$/.test(bom.id), bom.id);
check('BOM-Positionen + Stückzahl', bom.items.length >= 10 && bom.totals.pieces >= 30, `${bom.items.length} Pos / ${bom.totals?.pieces} Stk`);
check('BOM enthält Zukauf und Zuschnitt', bom.items.some((i) => i.kind === 'zukauf') && bom.items.some((i) => i.kind === 'zuschnitt'));

let received = null;
await page.route('**/erp-mock/bom', (route) => {
  received = {
    idempotency: route.request().headers()['idempotency-key'],
    schemaHeader: route.request().headers()['x-schema-version'],
    auth: route.request().headers()['authorization'],
    body: JSON.parse(route.request().postData()),
  };
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
});
await page.locator('#btn-settings').click();
await page.waitForTimeout(200);
await page.locator('#set-erp-endpoint').fill('https://erp.example/erp-mock/bom');
await page.locator('#set-erp-key').fill('test-key-123');
await page.locator('#btn-settings-save').click();
await page.locator('#btn-settings-close').click();
await page.waitForTimeout(200);
await page.locator('#btn-bom-sync').click();
await page.waitForTimeout(600);
check('Sync-Erfolgsmeldung', (await page.locator('#bom-status').textContent()).includes('übertragen'));
check('Idempotency-Key gesendet', received !== null && /^[0-9a-f-]{36}$/.test(received.idempotency ?? ''));
check('Schema-Version-Header', received?.schemaHeader === 'schreinercad-bom/1');
check('Bearer-Token gesendet', received?.auth === 'Bearer test-key-123');
check('Payload ist gültige BOM', received?.body?.schema === 'schreinercad-bom/1' && Array.isArray(received?.body?.items));

await page.route('**/erp-down/bom', (route) => route.fulfill({ status: 500, body: 'kaputt' }));
await page.locator('#btn-settings').click();
await page.waitForTimeout(200);
await page.locator('#set-erp-endpoint').fill('https://erp.example/erp-down/bom');
await page.locator('#btn-settings-save').click();
await page.locator('#btn-settings-close').click();
await page.waitForTimeout(200);
await page.locator('#btn-bom-sync').click();
await page.waitForTimeout(600);
check('Fehlermeldung bei HTTP 500', (await page.locator('#bom-status').textContent()).includes('500'));

console.log('— Möbeltypen: Esstisch —');
await showTab('entwurf');
await page.locator('[data-preset="esstisch"]').click();
await page.waitForTimeout(400);
check('Esstisch-Dokumentname', (await page.locator('#doc-name').textContent()).includes('Esstisch'));
check('Esstisch: 25 Bauteile', (await page.locator('#status-parts').textContent()).trim() === '25 Bauteile', await page.locator('#status-parts').textContent());
check('Esstisch: Aussenmass', (await page.locator('#status-dims').textContent()).includes('1800 × 750 × 900'));
check('Esstisch: 4 Montagestufen', (await page.locator('.tl-marker').count()) === 4);
check('Esstisch: Gestell im Baum', (await page.locator('#tree').textContent()).includes('Gestell (8)'));
check('Esstisch: Böden/Tür ausgeblendet', await page.locator('#p-shelves').isHidden() && await page.locator('#row-door').isHidden());
check('Esstisch: Beschläge deaktiviert', !(await page.locator('#hw-hinge').isEnabled()));
await page.locator('#btn-drawing').click();
await page.waitForTimeout(300);
check('Esstisch in Werkzeichnung', (await page.locator('#dialog-body').innerHTML()).includes('Esstisch'));
await page.locator('#btn-dlg-close').click();
await page.waitForTimeout(200);

console.log('— Möbeltypen: Standregal —');
await page.locator('[data-preset="buecherregal"]').click();
await page.waitForTimeout(400);
check('Standregal-Dokumentname', (await page.locator('#doc-name').textContent()).includes('Standregal'));
check('Standregal: 33 Bauteile', (await page.locator('#status-parts').textContent()).trim() === '33 Bauteile', await page.locator('#status-parts').textContent());
check('Standregal: 5 Montagestufen', (await page.locator('.tl-marker').count()) === 5);
check('Standregal: Böden sichtbar', !(await page.locator('#p-shelves').isHidden()));
check('Standregal: Typ-Grenzen aktiv (Höhe max 2200)', (await page.locator('#p-height').getAttribute('max')) === '2200');
await page.locator('#btn-anim').click();
await page.waitForTimeout(800);
check('Standregal: Montage-Animation läuft', (await page.locator('#btn-anim').textContent()).includes('Stopp'));
await page.locator('#btn-anim').click();
await page.waitForTimeout(200);

console.log('— Möbeltypen: zurück zum Hängeschrank —');
await page.locator('[data-preset="kueche"]').click();
await page.waitForTimeout(400);
check('Hängeschrank wiederhergestellt', (await page.locator('#doc-name').textContent()).includes('Hängeschrank'));
check('Beschläge wieder aktiv', await page.locator('#hw-hinge').isEnabled());

console.log('— Bohrbilder-DXF (CNC) —');
const [pdxfDl] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('#btn-partdxf').click(),
]);
const pdxf = fs.readFileSync(await pdxfDl.path(), 'utf-8');
check('Bohrbild-DXF: Kontur-Layer', pdxf.includes('TEILKONTUR'));
check('Bohrbild-DXF: Flächenbohrungen', pdxf.includes('BOHRUNG_FLAECHE') && pdxf.includes('CIRCLE'));
check('Bohrbild-DXF: Kantenbohrungen', pdxf.includes('BOHRUNG_KANTE'));
check('Bohrbild-DXF: Scharniertopf ø35 × 12', /o35 t12/.test(pdxf), pdxf.match(/o35 t\d+/)?.[0] ?? 'fehlt');
check('Bohrbild-DXF: Teile benannt', pdxf.includes('Seite links') && pdxf.includes('Korpusboden'));

console.log('— Projekte —');
await page.locator('#proj-name').fill('Werkstatt-Test');
await page.locator('#btn-proj-save').click();
await page.waitForTimeout(200);
check('Projekt gespeichert', (await page.locator('.proj-entry[data-project-name="Werkstatt-Test"]').count()) === 1);
// Parameter ändern, dann Projekt laden → Zustand wiederhergestellt
await page.locator('[data-preset="esstisch"]').click();
await page.waitForTimeout(300);
await page.locator('.proj-entry[data-project-name="Werkstatt-Test"] .proj-name').click();
await page.waitForTimeout(400);
check('Projekt laden stellt Namen wieder her', (await page.locator('#doc-name').textContent()).includes('Werkstatt-Test'));
check('Projekt laden stellt Masse wieder her', (await page.locator('#p-width').inputValue()) === '800');
const [projDl] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('#btn-proj-export').click(),
]);
const projJson = JSON.parse(fs.readFileSync(await projDl.path(), 'utf-8'));
check('Projekt-Export gültig', projJson.schema === 'schreinercad-projects/2' && projJson.projects.length >= 1);
// Nach Reload weiterhin vorhanden (localStorage)
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => !document.querySelector('#explode').disabled, { timeout: 15000 });
check('Projekt überlebt Reload', (await page.locator('.proj-entry[data-project-name="Werkstatt-Test"]').count()) === 1);
await page.locator('.proj-entry[data-project-name="Werkstatt-Test"] .cat-remove').click();
await page.waitForTimeout(200);
check('Projekt löschbar', (await page.locator('.proj-entry').count()) === 0);

console.log('— Start-Galerie & Versionierung —');
await page.locator('#btn-home').click();
await page.waitForTimeout(400);
check('Galerie offen', await page.locator('#home').isVisible());
check('Neues Design (3 Typen)', (await page.locator('#home-blank .card').count()) === 3);
check('Mindestens 9 Vorlagen', (await page.locator('#home-prebuilds .card').count()) >= 9);
check('Thumbnails generiert', (await page.locator('#home-prebuilds .card svg').count()) >= 9);
await page.locator('.card[data-card-name="Schreibtisch"]').click();
await page.waitForTimeout(400);
check('Vorlage öffnet Modell', (await page.locator('#doc-name').textContent()).includes('Schreibtisch'));
check('Galerie geschlossen', await page.locator('#home-backdrop').isHidden());
// Versionierung: zweimal speichern = v1, v2
await page.locator('#proj-name').fill('Serie-A');
await page.locator('#btn-proj-save').click();
await page.waitForTimeout(200);
await page.locator('#p-width').fill('1500');
await page.locator('#p-width').dispatchEvent('change');
await page.waitForTimeout(200);
await page.locator('#btn-proj-save').click();
await page.waitForTimeout(200);
check('v2 gespeichert', (await page.locator('#doc-name').textContent()).includes('Serie-A v2'));
await page.locator('.proj-entry[data-project-name="Serie-A"] .proj-meta').click();
await page.waitForTimeout(200);
check('Versionsliste sichtbar', (await page.locator('.ver-row').count()) === 2);
await page.locator('.ver-row[data-version="1"]').click();
await page.waitForTimeout(300);
check('v1 wiederhergestellt', (await page.locator('#p-width').inputValue()) === '1400');
check('Dokument zeigt v1', (await page.locator('#doc-name').textContent()).includes('Serie-A v1'));
await page.locator('.proj-entry[data-project-name="Serie-A"] .cat-remove').click();
await page.waitForTimeout(200);

console.log('— Schubladen (automatische Aufteilung) —');
await page.locator('[data-preset="kueche"]').click();
await page.waitForTimeout(300);
await page.locator('#p-drawers').check();
await page.waitForTimeout(400);
check('Schubladenschrank benannt', (await page.locator('#doc-name').textContent()).includes('Schubladenschrank'));
check('43 Bauteile mit 3 Schubladen', (await page.locator('#status-parts').textContent()).trim() === '43 Bauteile', await page.locator('#status-parts').textContent());
check('Auszüge in Stückliste', (await page.locator('#cutlist').textContent()).includes('Blum Tandem'));
check('Tür-Feld gesperrt', !(await page.locator('#p-door').isEnabled()));
check('Hinweis zur Aufteilung', (await page.locator('#hw-note').textContent()).includes('automatisch'));
await page.locator('#p-drawers').uncheck();
await page.waitForTimeout(300);
check('Zurück zum Hängeschrank', (await page.locator('#doc-name').textContent()).includes('Hängeschrank'));

console.log('— Beweis: Designer entwirft von Null ein individuelles Möbel —');
// 1. Neues Design aus der Galerie
await page.locator('#btn-home').click();
await page.waitForTimeout(300);
await page.locator('.card[data-card-name="Neuer Hängeschrank"]').click();
await page.waitForTimeout(400);
// 2. Individuelle Masse (kein Preset)
await page.locator('#p-width').fill('730');
await page.locator('#p-width').dispatchEvent('change');
await page.locator('#p-height').fill('540');
await page.locator('#p-height').dispatchEvent('change');
await page.locator('#p-depth').fill('280');
await page.locator('#p-depth').dispatchEvent('change');
await page.locator('#p-material').selectOption('nussbaum');
await page.waitForTimeout(400);
check('Individuelle Masse übernommen', (await page.locator('#status-dims').textContent()).includes('730 × 540 × 298'));
// 3. Herstellerkatalog nutzen und Beschlag individuell wählen
await page.locator('#cat-url').fill('catalogs/blum-beispiel.json');
await page.locator('#btn-cat-sync').click();
await page.waitForTimeout(400);
await page.locator('#hw-hinge').selectOption('Blum:cliptop-blumotion-110');
await page.locator('#hw-handle').selectOption('knob');
await page.waitForTimeout(400);
const customCutlist = await page.locator('#cutlist').textContent();
check('Katalog-Scharnier im Entwurf', customCutlist.includes('Blumotion'));
check('Individueller Griff im Entwurf', customCutlist.includes('Möbelknopf'));
// 4. Als Projekt sichern (v1) und Fertigungsunterlagen erzeugen
await page.locator('#proj-name').fill('Kunde-Meier-Individuell');
await page.locator('#btn-proj-save').click();
await page.waitForTimeout(200);
check('Individueller Entwurf als v1', (await page.locator('#doc-name').textContent()).includes('Kunde-Meier-Individuell v1'));
await page.locator('#btn-drawing').click();
await page.waitForTimeout(300);
const customDrawing = await page.locator('#dialog-body').innerHTML();
check('Zeichnung zeigt individuelle Breite', customDrawing.includes('>730<'));
check('Zeichnung mit Stückliste und Montagefolge', customDrawing.includes('Stückliste') && customDrawing.includes('Montagefolge'));
await page.locator('#btn-dlg-close').click();
await showTab('liste');
const [customBom] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('#btn-bom-json').click(),
]);
const customBomJson = JSON.parse(fs.readFileSync(await customBom.path(), 'utf-8'));
check('BOM des individuellen Entwurfs', customBomJson.params.widthMm === 730 && customBomJson.items.some((i) => i.material.includes('Blumotion')));
await showTab('entwurf');
await page.locator('.proj-entry[data-project-name="Kunde-Meier-Individuell"] .cat-remove').click();
await page.locator('.cat-entry[data-vendor="Blum"] .cat-remove').click();
await page.waitForTimeout(200);

console.log('— Interaktives Bearbeiten (Browser, Zeitleiste, jedes Teil parametrisch) —');
await page.locator('[data-preset="kueche"]').click();
await page.waitForTimeout(400);
const baseCount = Number((await page.locator('#status-parts').textContent()).replace(/\D/g, ''));
await page.locator('.tree-item[data-part-id="einlegeboden-1"] .ti-name').click();
await page.waitForTimeout(200);
check('Bearbeiten-Bereich sichtbar', await page.locator('#part-edit').isVisible());
// Umbenennen
await page.locator('#pe-name').fill('Tablar Sondermass');
await page.locator('#pe-rename').click();
await page.waitForTimeout(300);
check('Umbenannt im Browser', (await page.locator('#tree').textContent()).includes('Tablar Sondermass'));
check('Umbenannt in Stückliste', (await page.locator('#cutlist').textContent()).includes('Tablar Sondermass'));
// Individuelles Mass je Teil
await page.locator('#pe-sy').fill('25');
await page.locator('#pe-sy').dispatchEvent('change');
await page.waitForTimeout(300);
check('Teil individuell parametriert (Stärke 25)', (await page.locator('#pi-dims').textContent()).includes('× 25 mm'));
// Montagestufe ändern
await page.locator('#pe-step').selectOption('3');
await page.waitForTimeout(300);
check('Montagestufe geändert', (await page.locator('#pi-step').textContent()).startsWith('3'));
// Verschieben
await page.locator('[data-nudge="1,10"]').first().click();
await page.waitForTimeout(200);
check('Verschieben ohne Fehler', errors.length === 0);
// Duplizieren (Copy/Paste)
await page.locator('#pe-duplicate').click();
await page.waitForTimeout(300);
check('Kopie erzeugt', (await page.locator('#tree').textContent()).includes('(Kopie)'));
const afterCopy = Number((await page.locator('#status-parts').textContent()).replace(/\D/g, ''));
check('Teilzahl +1 nach Kopie', afterCopy === baseCount + 1, `${baseCount} -> ${afterCopy}`);
// Drag & Drop: Tür auf Zeitleisten-Stufe 2
await page.locator('.tree-item[data-part-id="tuer"] .ti-name').dragTo(page.locator('.tl-marker').nth(1));
await page.waitForTimeout(300);
await page.locator('.tree-item[data-part-id="tuer"] .ti-name').click();
await page.waitForTimeout(200);
check('Drag&Drop setzt Stufe 2', (await page.locator('#pi-step').textContent()).startsWith('2'));
// Stufe per Doppelklick umbenennen
page.once('dialog', (d) => d.accept('Vormontage'));
await page.locator('.tl-marker').first().dblclick();
await page.waitForTimeout(300);
check('Stufe umbenannt', (await page.locator('.tl-marker').first().getAttribute('title')).includes('Vormontage'));
// Unterdrücken
await page.locator('.tree-item[data-part-id="rueckwand"] .ti-name').click();
await page.waitForTimeout(200);
await page.locator('#pe-suppress').click();
await page.waitForTimeout(300);
check('Teil unterdrückt (aus Stückliste)', !(await page.locator('#cutlist').textContent()).includes('Rückwand'));
// Bearbeitungen überleben Speichern/Laden
await showTab('entwurf');
await page.locator('#proj-name').fill('Edit-Test');
await page.locator('#btn-proj-save').click();
await page.waitForTimeout(200);
await page.locator('[data-preset="kueche"]').click();
await page.waitForTimeout(300);
check('Preset setzt Bearbeitungen zurück', !(await page.locator('#tree').textContent()).includes('Tablar Sondermass'));
await page.locator('.proj-entry[data-project-name="Edit-Test"] .proj-name').click();
await page.waitForTimeout(400);
check('Bearbeitungen mit Projekt geladen', (await page.locator('#tree').textContent()).includes('Tablar Sondermass'));
// Alles zurücksetzen
await showTab('bauteil');
await page.locator('#pe-reset').click();
await page.waitForTimeout(300);
check('Zurücksetzen stellt Original her', (await page.locator('#cutlist').textContent()).includes('Rückwand'));
await showTab('entwurf');
await page.locator('.proj-entry[data-project-name="Edit-Test"] .cat-remove').click();
await page.waitForTimeout(200);

console.log('— Bauteil-Katalog & 3D-Bewegen —');
await page.locator('[data-preset="kueche"]').click();
await page.waitForTimeout(300);
const beforeInsert = Number((await page.locator('#status-parts').textContent()).replace(/\D/g, ''));
check('Katalog gerendert', (await page.locator('.cat-part').count()) >= 6);
await page.locator('.cat-part[data-catalog-key="leiste"]').click();
await page.waitForTimeout(300);
check('Leiste eingefügt (+1 Teil)', Number((await page.locator('#status-parts').textContent()).replace(/\D/g, '')) === beforeInsert + 1);
check('Leiste im Browser', (await page.locator('#tree').textContent()).includes('Leiste'));
check('Leiste in Stückliste', (await page.locator('#cutlist').textContent()).includes('Leiste'));
check('Eingefügtes Teil ausgewählt', (await page.locator('#pi-name').textContent()) === 'Leiste');
// Per Drag & Drop in die 3D-Ansicht
await page.locator('.cat-part[data-catalog-key="brett"]').dragTo(page.locator('#viewport > canvas'));
await page.waitForTimeout(300);
check('Brett per Drag & Drop eingefügt', Number((await page.locator('#status-parts').textContent()).replace(/\D/g, '')) === beforeInsert + 2);
// 3D-Bewegen-Modus: Gizmo an Auswahl, kein Fehler
await page.locator('#move-mode').check();
await page.waitForTimeout(200);
check('Bewegen-Modus aktiv ohne Fehler', errors.length === 0);
await page.locator('#move-mode').uncheck();
await page.locator('#pe-reset').click();
await page.waitForTimeout(300);

console.log('— Einstellungen & Katalog-Auto-Update —');
await page.locator('#btn-settings').click();
await page.waitForTimeout(200);
check('Einstellungs-Dialog offen', await page.locator('#settings').isVisible());
await page.locator('#set-sheet-l').fill('2500');
await page.locator('#btn-settings-save').click();
await page.waitForTimeout(200);
check('Einstellungen gespeichert', (await page.locator('#settings-status').textContent()).includes('gespeichert'));
await page.locator('#btn-settings-close').click();
await page.locator('#btn-cutplan').click();
await page.waitForTimeout(400);
check('Zuschnittplan nutzt Platteneinstellung', (await page.locator('#dialog-body').innerHTML()).includes('2500 × 2070'));
await page.locator('#btn-dlg-close').click();
// Auto-Update: URL-Katalog anlegen, Seite neu laden → automatisch aktualisiert
await showTab('entwurf');
await page.locator('#cat-url').fill('catalogs/blum-beispiel.json');
await page.locator('#btn-cat-sync').click();
await page.waitForTimeout(400);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => !document.querySelector('#explode').disabled, { timeout: 15000 });
await page.waitForTimeout(600);
const autoStatus = await page.locator('#cat-status').textContent();
check('Katalog-Auto-Update beim Start', autoStatus.includes('Auto-Update') && autoStatus.includes('aktualisiert'), autoStatus);
await page.locator('.cat-entry[data-vendor="Blum"] .cat-remove').click();
await page.waitForTimeout(200);

console.log('— 2D-Skizze (Zeichnen mit Fang) —');
await page.locator('[data-preset="kueche"]').click();
await page.waitForTimeout(300);
const beforeSketch = Number((await page.locator('#status-parts').textContent()).replace(/\D/g, ''));
await page.locator('#btn-sketch').click();
await page.waitForTimeout(300);
check('Skizzen-Dialog offen', await page.locator('#sketch').isVisible());
const skBox = await page.locator('#sketch-canvas').boundingBox();
const sk = await page.evaluate(() => {
  const c = document.querySelector('#sketch-canvas');
  return { scale: Number(c.dataset.scale), cx: Number(c.dataset.cx), cy: Number(c.dataset.cy) };
});
const toPage = (x, y) => ({ x: skBox.x + sk.cx + x * sk.scale, y: skBox.y + sk.cy - y * sk.scale });
// Rechteck oberhalb des Schranks (keine Kanten in der Nähe): 300 × 160 im 10er-Raster
let p1 = toPage(-200, 400);
let p2 = toPage(100, 560);
await page.mouse.move(p1.x, p1.y);
await page.mouse.down();
await page.mouse.move(p2.x, p2.y, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(200);
check('Rechteck gezeichnet', (await page.locator('#sk-status').textContent()).includes('1 Rechteck'));
// Zweites Rechteck: Startkante nahe der Seiten-Aussenkante (−405 → Fang auf −400)
p1 = toPage(-405, 400);
p2 = toPage(-100, 480);
await page.mouse.move(p1.x, p1.y);
await page.mouse.down();
await page.mouse.move(p2.x, p2.y, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(200);
check('Zweites Rechteck (Kantenfang)', (await page.locator('#sk-status').textContent()).includes('2 Rechteck'));
await page.locator('#btn-sk-apply').click();
await page.waitForTimeout(400);
check('Skizzenbretter eingefügt (+2)', Number((await page.locator('#status-parts').textContent()).replace(/\D/g, '')) === beforeSketch + 2);
check('Skizzenbrett im Browser', (await page.locator('#tree').textContent()).includes('Skizzenbrett'));
await page.locator('.tree-item[data-part-id^="sketch-"]').first().click();
await page.waitForTimeout(200);
check('Skizzenbrett 1: 300 × 160 (Raster)', (await page.locator('#pi-dims').textContent()).includes('300 × 160'), await page.locator('#pi-dims').textContent());
await page.locator('.tree-item[data-part-id^="sketch-"]').nth(1).click();
await page.waitForTimeout(200);
// Kantenfang: Startkante bei exakt −400 → Breite 300 trotz Start bei −405
check('Skizzenbrett 2: Kantenfang auf Aussenkante', (await page.locator('#pi-dims').textContent()).includes('300 ×'), await page.locator('#pi-dims').textContent());
await page.locator('#pe-reset').click();
await page.waitForTimeout(300);

console.log('— Fang-Einstellungen —');
await page.locator('#btn-settings').click();
await page.waitForTimeout(200);
check('Raster-Einstellung vorhanden', (await page.locator('#set-grid').inputValue()) === '5');
check('Bauteil-Fang aktiviert', await page.locator('#set-snap-part').isChecked());
await page.locator('#btn-settings-close').click();
await page.waitForTimeout(200);

console.log('— 2D-Skizze: Zoom, Pan, Auswahl, grosse Skizzen —');
await page.locator('#btn-sketch').click();
await page.waitForTimeout(300);
const skBox2 = await page.locator('#sketch-canvas').boundingBox();
const scaleBefore = Number(await page.locator('#sketch-canvas').getAttribute('data-scale'));
// Zoom mit dem Rad (um die Canvas-Mitte)
await page.mouse.move(skBox2.x + skBox2.width / 2, skBox2.y + skBox2.height / 2);
await page.mouse.wheel(0, -600);
await page.waitForTimeout(300);
const scaleAfter = Number(await page.locator('#sketch-canvas').getAttribute('data-scale'));
check('Rad-Zoom ändert Massstab', scaleAfter > scaleBefore * 1.2, `${scaleBefore} -> ${scaleAfter}`);
// Pan mit mittlerer Maustaste
const cxBefore = Number(await page.locator('#sketch-canvas').getAttribute('data-cx'));
await page.mouse.move(skBox2.x + 300, skBox2.y + 300);
await page.mouse.down({ button: 'middle' });
await page.mouse.move(skBox2.x + 450, skBox2.y + 340, { steps: 4 });
await page.mouse.up({ button: 'middle' });
await page.waitForTimeout(200);
const cxAfter = Number(await page.locator('#sketch-canvas').getAttribute('data-cx'));
check('Pan verschiebt Ansicht', Math.abs(cxAfter - cxBefore - 150) < 3, `${cxBefore} -> ${cxAfter}`);
// Einpassen
await page.locator('#btn-sk-fit').click();
await page.waitForTimeout(200);
check('Einpassen stellt Massstab wieder her', Math.abs(Number(await page.locator('#sketch-canvas').getAttribute('data-scale')) - scaleBefore) < 0.001);
// Grosse Skizze: 8 Rechtecke zügig zeichnen
const sk2 = await page.evaluate(() => {
  const c = document.querySelector('#sketch-canvas');
  return { scale: Number(c.dataset.scale), cx: Number(c.dataset.cx), cy: Number(c.dataset.cy) };
});
const toPage2 = (x, y) => ({ x: skBox2.x + sk2.cx + x * sk2.scale, y: skBox2.y + sk2.cy - y * sk2.scale });
for (let i = 0; i < 8; i++) {
  const a = toPage2(-560 + i * 130, 420);
  const b = toPage2(-560 + i * 130 + 100, 540);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 3 });
  await page.mouse.up();
}
await page.waitForTimeout(300);
check('8 Rechtecke gezeichnet', (await page.locator('#sk-status').textContent()).includes('8 Rechteck'));
// Auswahl per Klick + Entfernen
const mid = toPage2(-510, 480);
await page.mouse.click(mid.x, mid.y);
await page.waitForTimeout(200);
check('Rechteck ausgewählt', (await page.locator('#sk-status').textContent()).includes('ausgewählt'));
await page.locator('#btn-sk-delete').click();
await page.waitForTimeout(200);
check('Auswahl gelöscht (7 übrig)', (await page.locator('#sk-status').textContent()).includes('7 Rechteck'));
// Übernehmen: 7 Bretter
const beforeBig = Number((await page.locator('#status-parts').textContent()).replace(/\D/g, ''));
await page.locator('#btn-sk-apply').click();
await page.waitForTimeout(500);
check('7 Skizzenbretter eingefügt', Number((await page.locator('#status-parts').textContent()).replace(/\D/g, '')) === beforeBig + 7);
check('Grosse Skizze ohne Fehler', errors.length === 0);
await page.locator('#pe-reset').click();
await page.waitForTimeout(300);

console.log('— 2D-Skizze: Linie, Kreis, Messen (parametrische Extrusion) —');
await page.locator('#btn-sketch').click();
await page.waitForTimeout(300);
const skBox3 = await page.locator('#sketch-canvas').boundingBox();
const sk3 = await page.evaluate(() => {
  const c = document.querySelector('#sketch-canvas');
  return { scale: Number(c.dataset.scale), cx: Number(c.dataset.cx), cy: Number(c.dataset.cy) };
});
const toP3 = (x, y) => ({ x: skBox3.x + sk3.cx + x * sk3.scale, y: skBox3.y + sk3.cy - y * sk3.scale });
const beforeLC = Number((await page.locator('#status-parts').textContent()).replace(/\D/g, ''));
// Linie (waagrecht) → Leiste
await page.locator('.sk-tool[data-sk-tool="line"]').click();
let la = toP3(-300, 300), lb = toP3(0, 300);
await page.mouse.move(la.x, la.y); await page.mouse.down(); await page.mouse.move(lb.x, lb.y, { steps: 4 }); await page.mouse.up();
await page.waitForTimeout(150);
check('Linie gezeichnet', (await page.locator('#sk-status').textContent()).includes('1 Linie'));
// Kreis → Rundstab
await page.locator('.sk-tool[data-sk-tool="circle"]').click();
let ca = toP3(200, 300), ce = toP3(260, 300);
await page.mouse.move(ca.x, ca.y); await page.mouse.down(); await page.mouse.move(ce.x, ce.y, { steps: 4 }); await page.mouse.up();
await page.waitForTimeout(150);
check('Kreis gezeichnet', (await page.locator('#sk-status').textContent()).includes('1 Kreis'));
// Messen: Werkzeug aktivierbar
await page.locator('.sk-tool[data-sk-tool="measure"]').click();
la = toP3(-300, 100); lb = toP3(300, 100);
await page.mouse.click(la.x, la.y);
await page.mouse.move(lb.x, lb.y);
await page.mouse.click(lb.x, lb.y);
await page.waitForTimeout(150);
check('Messwerkzeug aktiv', (await page.locator('#sk-status').textContent()).includes('Messen'));
// Übernehmen → Leiste + Rundstab (parametrisch, im Browser editierbar)
await page.locator('#btn-sk-apply').click();
await page.waitForTimeout(400);
check('Linie/Kreis extrudiert (+2 Teile)', Number((await page.locator('#status-parts').textContent()).replace(/\D/g, '')) === beforeLC + 2);
check('Rundstab im Browser', (await page.locator('#tree').textContent()).includes('Rundstab'));
check('Skizzenleiste im Browser', (await page.locator('#tree').textContent()).includes('Skizzenleiste'));
await showTab('bauteil');
await page.locator('#pe-reset').click();
await page.waitForTimeout(200);

console.log('— Menüband ein-/ausklappen —');
await page.locator('#ribbon-toggle').click();
await page.waitForTimeout(150);
check('Menüband eingeklappt', await page.locator('#app.ribbon-collapsed').count() === 1);
await page.locator('#ribbon-toggle').click();
await page.waitForTimeout(150);
check('Menüband ausgeklappt', await page.locator('#app.ribbon-collapsed').count() === 0);

console.log('— Neu: Tabs, Baum-Löschen, Konstruktionsverlauf, Stufen, Ebenen, Blum, Kantenband —');
await page.locator('[data-preset="kueche"]').click();
await page.waitForTimeout(400);
// Inspector-Tabs
await showTab('verlauf');
check('Verlauf-Tab sichtbar', await page.locator('#step-list').isVisible());
const stepRows = await page.locator('.step-row').count();
check('Montagestufen im Verlauf', stepRows >= 5, `${stepRows} Stufen`);
// Stufe hinzufügen
await page.locator('#btn-step-add').click();
await page.waitForTimeout(300);
check('Zusätzliche Stufe angelegt', (await page.locator('.step-row').count()) === stepRows + 1);
// Stufe umbenennen (Konstruktionsverlauf) — Wert setzen und genau ein change-Event
// auslösen (kein Fokus-Rest, damit der folgende Klick nicht in einen Rebuild läuft)
await page.evaluate(() => {
  const input = document.querySelector('.step-row .step-name');
  input.value = 'Korpus vorbereiten';
  input.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(300);
check('Stufenname im Verlauf', (await page.locator('#hist-list').textContent()).includes('Korpus vorbereiten'));
// Baum-Löschen (✕ direkt auf der Zeile)
const partsBefore = Number((await page.locator('#status-parts').textContent()).replace(/\D/g, ''));
await page.locator('.tree-item[data-part-id="einlegeboden-1"] .ti-del').click();
await page.waitForTimeout(300);
check('Löschen im Baum entfernt Teil', Number((await page.locator('#status-parts').textContent()).replace(/\D/g, '')) === partsBefore - 1);
check('Löschung erscheint im Verlauf', (await page.locator('#hist-list').textContent()).includes('gelöscht'));
// Einzelne Bearbeitung im Verlauf zurücknehmen (↺)
const histRows = await page.locator('.hist-row').count();
check('Verlauf listet Bearbeitungen', histRows >= 3, `${histRows} Einträge`);
await page.locator('.hist-row .ti-del').first().click();
await page.waitForTimeout(300);
check('Bearbeitung einzeln zurückgenommen', (await page.locator('.hist-row').count()) === histRows - 1);
check('Gelöschtes Teil wieder da', Number((await page.locator('#status-parts').textContent()).replace(/\D/g, '')) === partsBefore);
await showTab('bauteil');
await page.locator('#pe-reset').click();
await page.waitForTimeout(300);
// Mehrflächen-Skizze: Ebene wechseln
await page.locator('#btn-sketch').click();
await page.waitForTimeout(200);
await page.locator('#sk-plane').selectOption('side');
await page.waitForTimeout(200);
check('Skizzenebene Seite (ZY)', (await page.locator('#sk-title').textContent()).includes('Seite'));
await page.locator('#sk-plane').selectOption('top');
await page.waitForTimeout(200);
check('Skizzenebene Oben (XZ)', (await page.locator('#sk-title').textContent()).includes('Oben'));
await page.locator('#btn-sk-close').click();
await page.waitForTimeout(200);
// Blum-Katalog per Knopfdruck
await showTab('entwurf');
await page.locator('#btn-cat-blum').click();
await page.waitForTimeout(700);
check('Blum-Katalog per Knopf geladen', (await page.locator('.cat-entry[data-vendor="Blum"]').count()) === 1);
const blumOptions = await page.locator('#hw-hinge option').allTextContents();
check('CLIP top BLUMOTION verfügbar', blumOptions.some((o) => o.includes('CLIP top BLUMOTION') && o.includes('[Blum]')), blumOptions.slice(0, 4).join(' | '));
// Häfele-Bibliothek per Knopfdruck
await page.locator('#btn-cat-haefele').click();
await page.waitForTimeout(700);
check('Häfele-Bibliothek geladen', (await page.locator('.cat-entry[data-vendor="Häfele"]').count()) === 1);
check('Häfele Metalla verfügbar', (await page.locator('#hw-hinge option').allTextContents()).some((o) => o.includes('Metalla') && o.includes('[Häfele]')));
// Hettich-Bibliothek per Knopfdruck
await page.locator('#btn-cat-hettich').click();
await page.waitForTimeout(700);
check('Hettich-Bibliothek geladen', (await page.locator('.cat-entry[data-vendor="Hettich"]').count()) === 1);
check('Hettich Sensys verfügbar', (await page.locator('#hw-hinge option').allTextContents()).some((o) => o.includes('Sensys') && o.includes('[Hettich]')));
await page.locator('.cat-entry[data-vendor="Blum"] .cat-remove').click();
await page.waitForTimeout(100);
await page.locator('.cat-entry[data-vendor="Häfele"] .cat-remove').click();
await page.waitForTimeout(100);
await page.locator('.cat-entry[data-vendor="Hettich"] .cat-remove').click();
await page.waitForTimeout(200);
// Kantenband-Bedarf (JoinerCAD-Überzugsmaterial) in der Stückliste
await showTab('liste');
check('Kantenband-Bedarf ausgewiesen', (await page.locator('#eb-total').textContent()).includes('Kantenband-Bedarf'));
// Modellieren-Toolbar: Extrudieren, Bohrung, Fase
await page.locator('#btn-extrude').click();
await page.waitForTimeout(200);
check('Extrudieren öffnet Skizze', await page.locator('#sketch').isVisible());
await page.locator('#btn-sk-close').click();
await page.waitForTimeout(150);
await page.locator('.tree-item[data-part-id="boden"] .ti-name').click();
await page.waitForTimeout(150);
const partsBeforeHole = Number((await page.locator('#status-parts').textContent()).replace(/\D/g, ''));
await page.locator('#btn-hole').click();
await page.waitForTimeout(300);
// Bohrung ist ein echter CSG-Ausschnitt (Merkmal am Teil), kein neues Bauteil
check('Bohrung als CSG-Merkmal (Teilzahl unverändert)', Number((await page.locator('#status-parts').textContent()).replace(/\D/g, '')) === partsBeforeHole);
await page.locator('.tree-item[data-part-id="boden"] .ti-name').click();
await page.waitForTimeout(150);
await page.locator('#btn-chamfer').click();
await page.waitForTimeout(300);
await showTab('verlauf');
check('Bohrung erscheint im Verlauf', (await page.locator('#hist-list').textContent()).includes('Bohrung'));
check('Fase erscheint im Verlauf', (await page.locator('#hist-list').textContent()).includes('Kante gebrochen'));
await showTab('bauteil');
await page.locator('#pe-reset').click();
await page.waitForTimeout(200);
// 3D-Bewegen mit Fang (Gizmo)
await page.locator('.tree-item[data-part-id="boden"] .ti-name').click();
await page.waitForTimeout(150);
await page.locator('#move-mode').check();
await page.waitForTimeout(200);
check('Bewegen-Modus (Gizmo) ohne Fehler', errors.length === 0);
await page.locator('#move-mode').uncheck();

console.log('— Durchgängiger Workflow: Skizze → Teil → Baugruppe → Bohrung → Stufe → Tablar → CAM —');
await page.locator('[data-preset="kueche"]').click();
await page.waitForTimeout(400);
await showTab('entwurf');
// 1) Tablare (Einlegeböden) flexibel anpassen
await page.locator('#p-shelves').fill('3');
await page.locator('#p-shelves').dispatchEvent('change');
await page.waitForTimeout(300);
check('WF1 Tablare im Baum (Ausstattung 3)', (await page.locator('#tree').textContent()).includes('Ausstattung (3)'));
const wfBase = Number((await page.locator('#status-parts').textContent()).replace(/\D/g, ''));
// 2) Skizze → 3D-Teil in der Baugruppe
await page.locator('#btn-sketch').click();
await page.waitForTimeout(300);
const wfBox = await page.locator('#sketch-canvas').boundingBox();
const wfSk = await page.evaluate(() => {
  const c = document.querySelector('#sketch-canvas');
  return { scale: Number(c.dataset.scale), cx: Number(c.dataset.cx), cy: Number(c.dataset.cy) };
});
const wfP = (x, y) => ({ x: wfBox.x + wfSk.cx + x * wfSk.scale, y: wfBox.y + wfSk.cy - y * wfSk.scale });
const wa = wfP(-150, 450), wb = wfP(150, 600);
await page.mouse.move(wa.x, wa.y); await page.mouse.down(); await page.mouse.move(wb.x, wb.y, { steps: 4 }); await page.mouse.up();
await page.waitForTimeout(150);
await page.locator('#btn-sk-apply').click();
await page.waitForTimeout(400);
check('WF2 Skizzenteil in Baugruppe (+1)', Number((await page.locator('#status-parts').textContent()).replace(/\D/g, '')) === wfBase + 1);
// 3) Echte Bohrung (CSG) in ein Bauteil
await page.locator('.tree-item[data-part-id="boden"] .ti-name').click();
await page.waitForTimeout(150);
const wfBeforeHole = Number((await page.locator('#status-parts').textContent()).replace(/\D/g, ''));
await page.locator('#btn-hole').click();
await page.waitForTimeout(300);
check('WF3 Bohrung als CSG-Merkmal', Number((await page.locator('#status-parts').textContent()).replace(/\D/g, '')) === wfBeforeHole);
await showTab('verlauf');
check('WF3b Bohrung im Verlauf', (await page.locator('#hist-list').textContent()).includes('Bohrung'));
await showTab('bauteil');
// 4) Montagestufe eines Teils flexibel ändern
await page.locator('.tree-item[data-part-id="tuer"] .ti-name').click();
await page.waitForTimeout(150);
await page.locator('#pe-step').selectOption('2');
await page.waitForTimeout(300);
check('WF4 Montagestufe geändert', (await page.locator('#pi-step').textContent()).startsWith('2'));
// 5) Bauteilmass änderbar → Stückliste/CAM aktualisiert
await page.locator('.tree-item[data-part-id="boden"] .ti-name').click();
await page.waitForTimeout(150);
await page.locator('#pe-sx').fill('760');
await page.locator('#pe-sx').dispatchEvent('change');
await page.waitForTimeout(300);
await showTab('liste');
check('WF5 Mass änderbar (760 in Stückliste)', (await page.locator('#cutlist').textContent()).includes('760'));
// 6) CAM: Zuschnittplan-Optimierung
await page.locator('#btn-cutplan').click();
await page.waitForTimeout(400);
const wfPlan = await page.locator('#dialog-body').innerHTML();
check('WF6 Zuschnitt-Optimierung ausgewiesen', wfPlan.includes('Zuschnitt-Optimierung') && /Ausnutzung \d+ %/.test(wfPlan));
await page.locator('#btn-dlg-close').click();
await page.waitForTimeout(150);
// 7) CAM: Bohrbilder-DXF mit Bohrungen
const [wfDxf] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-partdxf').click()]);
const wfDxfTxt = fs.readFileSync(await wfDxf.path(), 'utf-8');
check('WF7 Bohrbild-DXF mit Bohrungen (CIRCLE)', wfDxfTxt.includes('CIRCLE') && wfDxfTxt.includes('BOHRUNG'));
// alles rücksetzbar → Konstruktionsverlauf leer
await showTab('bauteil');
await page.locator('#pe-reset').click();
await page.waitForTimeout(200);
await showTab('verlauf');
check('WF8 Alle Bearbeitungen rücksetzbar (Verlauf leer)', (await page.locator('.hist-row').count()) === 0);

console.log('— Boolesche Operationen (Vereinen) & Mehrfachbohrung (CSG) —');
await page.locator('[data-preset="kueche"]').click();
await page.waitForTimeout(500);
// Mehrfachbohrung: zwei Bohrungen (System-32-Reihe) in ein Teil
await page.locator('.tree-item[data-part-id="boden"] .ti-name').click();
await page.waitForTimeout(150);
await page.locator('#btn-hole').click();
await page.waitForTimeout(200);
await page.locator('#btn-hole').click();
await page.waitForTimeout(250);
await showTab('verlauf');
check('Mehrfachbohrung 2× im Verlauf', (await page.locator('#hist-list').textContent()).includes('2× Bohrung'));
await showTab('bauteil');
await page.locator('#pe-reset').click();
await page.waitForTimeout(200);
// Vereinen zweier eingefügter Bretter zu einem CSG-Körper
const nbBool = Number((await page.locator('#status-parts').textContent()).replace(/\D/g, ''));
await page.locator('.cat-part[data-catalog-key="brett"]').click();
await page.waitForTimeout(200);
await page.locator('.cat-part[data-catalog-key="brett"]').click();
await page.waitForTimeout(200);
check('Zwei Bretter eingefügt (+2)', Number((await page.locator('#status-parts').textContent()).replace(/\D/g, '')) === nbBool + 2);
const bretter = page.locator('.tree-item').filter({ hasText: 'Brett' });
await bretter.first().locator('.ti-name').click();
await page.waitForTimeout(150);
await page.locator('#btn-union').click();
await page.waitForTimeout(150);
await bretter.nth(1).locator('.ti-name').click();
await page.waitForTimeout(500);
check('Vereinen erzeugt CSG-Körper (2→1)', Number((await page.locator('#status-parts').textContent()).replace(/\D/g, '')) === nbBool + 1);
await showTab('verlauf');
check('Vereinen im Verlauf', (await page.locator('#hist-list').textContent()).includes('Vereinen'));
await showTab('bauteil');
await page.locator('#pe-reset').click();
await page.waitForTimeout(200);
check('Booleans/Bohrungen rücksetzbar', Number((await page.locator('#status-parts').textContent()).replace(/\D/g, '')) === nbBool);

console.log('— Kontextmenü (Rechtsklick) & Press/Pull (Grösse ziehen) —');
await page.locator('[data-preset="kueche"]').click();
await page.waitForTimeout(400);
const cbox = await page.locator('#viewport > canvas').boundingBox();
await page.locator('#viewport > canvas').click({ button: 'right', position: { x: cbox.width * 0.5, y: cbox.height * 0.5 } });
await page.waitForTimeout(200);
check('Kontextmenü erscheint', await page.locator('.ctx-menu').isVisible());
check('Kontextmenü mit Aktionen', (await page.locator('.ctx-item').count()) >= 6);
const nbCtx = Number((await page.locator('#status-parts').textContent()).replace(/\D/g, ''));
await page.locator('.ctx-item', { hasText: 'Duplizieren' }).click();
await page.waitForTimeout(300);
check('Kontextmenü: Duplizieren (+1)', Number((await page.locator('#status-parts').textContent()).replace(/\D/g, '')) === nbCtx + 1);
check('Kontextmenü schliesst nach Aktion', (await page.locator('.ctx-menu').count()) === 0);
await showTab('bauteil');
await page.locator('#pe-reset').click();
await page.waitForTimeout(200);
// Press/Pull-Umschalter: schliesst Bewegen gegenseitig aus
await page.locator('#move-mode').check();
await page.waitForTimeout(100);
await page.locator('#resize-mode').check();
await page.waitForTimeout(150);
check('Grösse-Modus deaktiviert Bewegen', (await page.locator('#move-mode').isChecked()) === false && (await page.locator('#resize-mode').isChecked()) === true);
check('Press/Pull ohne Fehler', errors.length === 0);
await page.locator('#resize-mode').uncheck();
await page.waitForTimeout(100);

console.log('— Direktes Bohren auf der Fläche (on-model) —');
await page.locator('[data-preset="kueche"]').click();
await page.waitForTimeout(500);
const dbox = await page.locator('#viewport > canvas').boundingBox();
await page.locator('#drill-mode').check();
await page.waitForTimeout(150);
await page.locator('#viewport > canvas').click({ position: { x: dbox.width * 0.5, y: dbox.height * 0.55 } });
await page.waitForTimeout(350);
await showTab('verlauf');
check('Direktes Bohren setzt Bohrung (on-model)', (await page.locator('#hist-list').textContent()).includes('Bohrung'));
await page.locator('#drill-mode').uncheck();
await page.waitForTimeout(100);
await showTab('bauteil');
await page.locator('#pe-reset').click();
await page.waitForTimeout(200);

console.log('— Skizze auf Fläche (on-model): Ebene aus der Flächennormale —');
await page.locator('[data-preset="kueche"]').click();
await page.waitForTimeout(500);
const fsBox = await page.locator('#viewport > canvas').boundingBox();
await page.locator('#facesketch-mode').check();
await page.waitForTimeout(150);
// Klick auf die Frontfläche (Tür) → Skizzenebene Front (XY)
await page.locator('#viewport > canvas').click({ position: { x: fsBox.width * 0.5, y: fsBox.height * 0.55 } });
await page.waitForTimeout(300);
check('Flächen-Skizze öffnet Dialog', await page.locator('#sketch').isVisible());
check('Skizzenebene aus Fläche (Front)', (await page.locator('#sk-title').textContent()).includes('Front'));
check('Bohren/Skizze-Modus danach aus', (await page.locator('#facesketch-mode').isChecked()) === false);
// Rechteck zeichnen und übernehmen → Teil auf der Fläche
const fsSk = await page.evaluate(() => { const c = document.querySelector('#sketch-canvas'); return { scale: Number(c.dataset.scale), cx: Number(c.dataset.cx), cy: Number(c.dataset.cy) }; });
const fsP = (x, y) => ({ x: fsBox.x + fsSk.cx + x * fsSk.scale, y: fsBox.y + fsSk.cy - y * fsSk.scale });
const fsBefore = Number((await page.locator('#status-parts').textContent()).replace(/\D/g, ''));
const q1 = fsP(-100, -100), q2 = fsP(100, 100);
await page.mouse.move(q1.x, q1.y); await page.mouse.down(); await page.mouse.move(q2.x, q2.y, { steps: 4 }); await page.mouse.up();
await page.waitForTimeout(150);
await page.locator('#btn-sk-apply').click();
await page.waitForTimeout(400);
check('Flächen-Skizze extrudiert Teil (+1)', Number((await page.locator('#status-parts').textContent()).replace(/\D/g, '')) === fsBefore + 1);
await showTab('bauteil');
await page.locator('#pe-reset').click();
await page.waitForTimeout(200);

console.log('— Montagereihenfolge: Selbstoptimierung —');
await page.locator('[data-preset="kueche"]').click();
await page.waitForTimeout(400);
await showTab('verlauf');
await page.locator('#btn-optimize').click();
await page.waitForTimeout(400);
const optNames = await page.locator('.step-row .step-name').evaluateAll((els) => els.map((e) => e.value));
check('Optimierung: erste Stufe = Boden', optNames[0] === 'Boden', optNames.join(' | '));
check('Optimierung: Reihenfolge Boden→Seiten→…→Beschläge', optNames.includes('Seiten') && optNames.includes('Beschläge') && optNames.indexOf('Boden') < optNames.indexOf('Beschläge'));
check('Optimierung: im Verlauf vermerkt', (await page.locator('#hist-list').textContent()).includes('optimiert'));
// manueller Eingriff bleibt als Pin erhalten, Auto-Ordnung bleibt aktiv
await page.locator('.step-row').last().locator('.step-name').fill('Endmontage');
await page.waitForTimeout(300);
check('Optimierung bleibt trotz Umbenennung aktiv', (await page.locator('#hist-list').textContent()).includes('optimiert'));
// erneut klicken → aus
await page.locator('#btn-optimize').click();
await page.waitForTimeout(300);
check('Auto-Optimierung abschaltbar', (await page.locator('#hist-list').textContent()).includes('optimiert') === false);

check('Keine Konsolen-Fehler insgesamt', errors.length === 0, errors.join(' | '));

console.log(`\nErgebnis: ${pass} bestanden, ${fail} fehlgeschlagen`);
await browser.close();
server.kill();
process.exit(fail === 0 ? 0 : 1);
