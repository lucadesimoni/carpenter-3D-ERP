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
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
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

check('Keine Konsolen-Fehler insgesamt', errors.length === 0, errors.join(' | '));

console.log(`\nErgebnis: ${pass} bestanden, ${fail} fehlgeschlagen`);
await browser.close();
server.kill();
process.exit(fail === 0 ? 0 : 1);
