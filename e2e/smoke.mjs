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
await page.locator('.tree-item[data-part-id="tuer"] span').click();
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
await page.locator('#bom-endpoint').fill('https://erp.example/erp-mock/bom');
await page.locator('#bom-apikey').fill('test-key-123');
await page.locator('#btn-bom-sync').click();
await page.waitForTimeout(600);
check('Sync-Erfolgsmeldung', (await page.locator('#bom-status').textContent()).includes('übertragen'));
check('Idempotency-Key gesendet', received !== null && /^[0-9a-f-]{36}$/.test(received.idempotency ?? ''));
check('Schema-Version-Header', received?.schemaHeader === 'schreinercad-bom/1');
check('Bearer-Token gesendet', received?.auth === 'Bearer test-key-123');
check('Payload ist gültige BOM', received?.body?.schema === 'schreinercad-bom/1' && Array.isArray(received?.body?.items));

await page.route('**/erp-down/bom', (route) => route.fulfill({ status: 500, body: 'kaputt' }));
await page.locator('#bom-endpoint').fill('https://erp.example/erp-down/bom');
await page.locator('#btn-bom-sync').click();
await page.waitForTimeout(600);
check('Fehlermeldung bei HTTP 500', (await page.locator('#bom-status').textContent()).includes('500'));

console.log('— Möbeltypen: Esstisch —');
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
const [customBom] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('#btn-bom-json').click(),
]);
const customBomJson = JSON.parse(fs.readFileSync(await customBom.path(), 'utf-8'));
check('BOM des individuellen Entwurfs', customBomJson.params.widthMm === 730 && customBomJson.items.some((i) => i.material.includes('Blumotion')));
await page.locator('.proj-entry[data-project-name="Kunde-Meier-Individuell"] .cat-remove').click();
await page.locator('.cat-entry[data-vendor="Blum"] .cat-remove').click();
await page.waitForTimeout(200);

check('Keine Konsolen-Fehler insgesamt', errors.length === 0, errors.join(' | '));

console.log(`\nErgebnis: ${pass} bestanden, ${fail} fehlgeschlagen`);
await browser.close();
server.kill();
process.exit(fail === 0 ? 0 : 1);
