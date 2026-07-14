# SchreinerCAD 🪚

Parametrisches 3D-CAD für Schreiner — läuft komplett im Browser, ohne Server-Backend.
Oberfläche und Werkzeuge orientieren sich an Autodesk Fusion (ViewCube, Browser-Baum,
Zeitleiste, Prüfwerkzeuge). Enthalten ist eine funktionierende Beispiel-Baugruppe:
ein **Hängeschrank** (Korpus mit Dübelverbindung, eingenuteter Rückwand,
Einlegeböden und optionaler Tür).

![Stack](https://img.shields.io/badge/Stack-Vite%20%2B%20TypeScript%20%2B%20Three.js-blue)

## Funktionen

- **Mehrere Möbeltypen** — Hängeschrank (Korpus), Esstisch (Beine/Zargen/Platte,
  gedübelt) und Standregal (feste Böden, eingenutete Rückwand); Typ-Auswahl mit
  eigenen Parametergrenzen und Vorlagen. Neue Möbel = ein weiterer Builder in
  `src/core/furniture.ts` — Viewer, Stückliste, Werkzeichnung, Zuschnittplan,
  BOM und GLB sind vollständig generisch.
- **Parametrisches Modell** — Breite, Höhe, Tiefe, Materialstärke, Anzahl Einlegeböden,
  Tür ein/aus und Material (Eiche, Buche, Nussbaum, Fichte, MDF) live änderbar;
  die Baugruppe wird sofort neu aufgebaut.
- **ViewCube** — Orientierungswürfel oben rechts (Autodesk-Stil); Klick auf eine
  Fläche fährt die Kamera weich auf die Normansicht.
- **Browser-Baum** — alle Bauteile hierarchisch (Korpus, Rückwand, Ausstattung,
  Front, Verbindungen) mit Auge-Symbol zum Ein-/Ausblenden; Klick wählt das Teil aus.
- **Zeitleiste** — Montagestufen wie eine parametrische Historie durchblättern
  (Marker oder Scrubber); die Montage-Animation läuft synchron über die Zeitleiste.
- **Messen** — zwei Punkte auf Bauteilen anklicken: Abstand in mm plus Δx/Δy/Δz.
- **Schnittansicht** — Schnittebene entlang X/Y/Z frei positionierbar,
  mit halbtransparenter Ebenen-Anzeige (Analyse wie in Fusion).
- **Orthogonale Projektion** — perspektivisch/ortho umschaltbar.
- **Explosionsansicht** — stufenlos per Schieberegler; jedes Bauteil kennt seine
  Ausbaurichtung (Dübel bleiben bei ihrer Verbindung).
- **Montage-Animation** — die Baugruppe setzt sich in 7 Montagestufen selbst zusammen
  (Boden → Dübel → Seiten → Deckel → Rückwand → Einlegeböden → Tür).
- **Bauteil-Auswahl** — Klick auf ein Teil zeigt Bezeichnung, Zuschnittmasse,
  Material, Laufrichtung und Montagestufe.
- **Bemassung** — Aussenmasse (B × H × T) als Masslinien mit mm-Angaben einblendbar.
- **Stückliste / Zuschnittliste** — automatisch aus dem Modell abgeleitet, gleiche
  Teile werden gruppiert; Plattenbedarf in m²; Export als CSV (Excel-tauglich).
- **Beschläge-Bibliothek** — vorkonfigurierte Systeme mit Beispiel-Referenzen:
  Topfscharniere 110°/155° (z.B. Blum Clip top, Anzahl automatisch nach Türhöhe,
  Topf ø35 + Montageplatte System 32), Griffstange oder Möbelknopf (z.B. Häfele),
  Bodenträger ø5 und verstellbare Schrankaufhänger (z.B. Camar) — alle Teile
  erscheinen im 3D-Modell, im Browser-Baum und in der Stückliste.
- **Werkzeichnung** — bemasstes Zeichnungsblatt (A3, Vorder-/Seiten-/Draufsicht,
  verdeckte Kanten gestrichelt, Titelblock mit Massstab) — druckbar, SVG-Export.
- **Zuschnittplan** — automatische Plattenaufteilung auf 2800 × 2070 mm
  (Laufrichtung bleibt erhalten, Sägeblatt 4 mm, Besäumkante 10 mm) mit
  Nutzungsgrad je Platte — SVG- und DXF-Export (CNC-tauglich).
- **GLB-Export** — das 3D-Modell als binäres glTF (Masse in Metern) für
  Visualisierung und Weiterverarbeitung.
- **BOM-Export & ERP-Sync** — strukturierte Stückliste als JSON
  (Schema `schreinercad-bom/1`) zum Download oder per HTTP POST an einen
  konfigurierbaren ERP-Endpunkt, nach gängiger Webhook-Praxis mit
  Ereignis-UUID, `Idempotency-Key`- und `X-Schema-Version`-Header sowie
  optionalem Bearer-Token.
- **Herstellerkatalog-Import & -Sync** — Beschläge-Kataloge (Schema
  `schreinercad-catalog/1`) per JSON-Datei importieren oder von einer URL
  synchronisieren; Einträge erscheinen in den Auswahlfeldern
  (z.B. «Clip top Blumotion 110° [Blum]»), werden in localStorage
  persistiert und lassen sich einzeln wieder entfernen. Beispielkataloge
  liegen unter `public/catalogs/` (inoffizielle Demo-Daten).
- **Kamera-Presets & Screenshot** — Iso/Front/Seite/Oben, PNG-Export der Ansicht.
- **Prozedurale Holztexturen** — keine Asset-Downloads, alles wird zur Laufzeit erzeugt.

## Konstruktion der Beispiel-Baugruppe

- Seiten laufen durch, Korpusboden/-deckel dazwischen, verbunden mit Holzdübeln ø8 × 40
  (3 Stück je Eckverbindung)
- Rückwand 8 mm HDF, eingenutet (12 mm hinter der Hinterkante)
- Einlegeböden mit 1 mm Luft je Seite, 5 mm hinter der Vorderkante zurückgesetzt
- Optionale aufschlagende Tür mit Edelstahl-Griffstange

Alle Masse in Millimetern. Koordinaten: x = Breite, y = Höhe, z = Tiefe.

## Starten

```bash
npm install
npm run dev        # Entwicklungsserver, öffnet http://localhost:5173
```

## Produktions-Build

```bash
npm run build      # Typprüfung + Build nach dist/
npm run preview    # gebauten Stand lokal testen
```

## End-to-End-Test

```bash
npm run build
npm run test:e2e   # Playwright/Chromium, headless; startet den Preview-Server selbst
```

101 Prüfungen: Rendering, Intro-Animation, Stückliste, CSV-Inhalt, PNG-Export,
Parameter-Clamping, Randkonfigurationen (0 Böden / keine Tür), Materialwechsel,
Explosion, Bemassung, Auswahl/Abwahl, ViewCube, Ortho-Projektion, Browser-Baum
(Auswahl + Sichtbarkeit), Zeitleiste, Messen, Schnittansicht, Kamera-Presets,
Beschläge-Bibliothek, Werkzeichnung (Inhalt + SVG-Download), Zuschnittplan
(Inhalt + DXF-Download), GLB-Export, Katalog-Import/Sync/Entfernen/Validierung,
BOM-JSON-Inhalt, ERP-Sync (Header, Payload, Fehlerfall via Mock-Endpunkt),
Möbeltypen (Esstisch/Standregal: Teilzahlen,
Stufen, Typ-Grenzen, Feld-Sichtbarkeit, Werkzeichnung), Konsolen-Fehler.
Falls Playwright-Browser nicht installiert sind: `npx playwright install chromium`
oder `CHROMIUM_PATH=/pfad/zu/chrome npm run test:e2e`.

Der Build verwendet relative Pfade (`base: './'`) und läuft daher ohne Anpassung
auf jedem statischen Hosting (GitHub Pages, Netlify, nginx, …).

## Projektstruktur

```
src/
  core/
    types.ts      Datenmodell (PartSpec, Assembly, Parameter, Beschläge)
    cabinet.ts    Parametrischer Hängeschrank
    furniture.ts  Möbeltypen-Dispatch + Esstisch- und Standregal-Builder
    hardware.ts   Beschläge-Registry (Scharniere, Griffe, Träger, Aufhänger)
    catalog.ts    Herstellerkatalog-Import/-Sync (JSON, localStorage)
    bom.ts        BOM-JSON (schreinercad-bom/1) + ERP-Synchronisierung
    cutlist.ts    Stückliste + CSV-Export
    drawing.ts    Werkzeichnung (bemasstes SVG-Zeichnungsblatt)
    nesting.ts    Zuschnittplan (Plattenaufteilung, SVG + DXF)
    wood.ts       Prozedurale Holz-Materialien (Canvas-Texturen)
  viewer/
    viewer.ts     Three.js-Szene: Explosion, Animation, Auswahl, Bemassung,
                  Messen, Schnitt, Ortho-Projektion, Zeitleisten-Sichtbarkeit
    viewcube.ts   ViewCube (Orientierungswürfel, Autodesk-Stil)
  main.ts         UI-Verdrahtung (Ribbon, Browser-Baum, Zeitleiste, Panels)
  style.css       Layout & Design
index.html        App-Shell
```

## Eigene Baugruppen

`src/core/cabinet.ts` zeigt das Muster: eine Funktion, die aus Parametern eine Liste
von `PartSpec`-Objekten erzeugt (Masse, Position, Material, Laufrichtung,
Explosionsrichtung, Montagestufe, Zuschnittmasse). Viewer und Stückliste sind
generisch — eine neue Baugruppe braucht nur einen neuen Builder.

## Integrations-Schemas

### BOM (`schreinercad-bom/1`)

`⬇ BOM (JSON)` bzw. `⇄ BOM an ERP senden` erzeugt:

```json
{
  "schema": "schreinercad-bom/1",
  "id": "8c7f…-uuid",
  "document": "haengeschrank-800x600x320",
  "createdAt": "2026-07-14T08:00:00.000Z",
  "params": { "widthMm": 800, "heightMm": 600, "depthMm": 320, "thicknessMm": 18, "shelves": 2, "door": true, "material": "eiche" },
  "overallMm": { "width": 800, "height": 600, "depth": 338 },
  "items": [
    { "pos": 1, "name": "Korpusboden", "qty": 1, "dims": "764 × 320 × 18", "material": "Eiche furniert", "areaM2": 0.2445, "kind": "zuschnitt" },
    { "pos": 8, "name": "Topfscharnier 110°", "qty": 2, "dims": "Topf ø35, Bohrabstand 24", "material": "z.B. Blum Clip top 110°", "areaM2": 0, "kind": "zukauf" }
  ],
  "totals": { "panelAreaM2": 2.2401, "positions": 12, "pieces": 35 }
}
```

Der POST sendet zusätzlich `Idempotency-Key: <id>`, `X-Schema-Version: schreinercad-bom/1`
und optional `Authorization: Bearer <API-Schlüssel>`. Der Endpunkt sollte mit 2xx antworten
und über die Ereignis-ID deduplizieren.

### Herstellerkatalog (`schreinercad-catalog/1`)

```json
{
  "schema": "schreinercad-catalog/1",
  "vendor": "Blum",
  "note": "optionaler Hinweis",
  "items": [
    { "kind": "hinge", "key": "cliptop-blumotion-110", "label": "Clip top Blumotion 110°", "vendor": "Blum Clip top Blumotion 110°", "cupDiameter": 35 },
    { "kind": "handle", "key": "h1525-320", "label": "Griffstange ø12 × 320", "vendor": "Häfele H1525", "style": "bar", "diameter": 12, "length": 320 }
  ]
}
```

Hinweis: Blums natives Austauschformat für Beschlag- und Bohrdaten ist **BXF**
(Blum Exchange Format, XML) aus DYNALOG/DYNAPLAN; Händlerdaten kommen häufig
als CSV/XLS. Ein BXF-/CSV-Importer, der auf dieses Katalogschema abbildet,
ist der natürliche nächste Ausbauschritt.
