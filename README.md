# SchreinerCAD 🪚

Parametrisches 3D-CAD für Schreiner — läuft komplett im Browser, ohne Server-Backend.
Oberfläche und Werkzeuge orientieren sich an Autodesk Fusion (ViewCube, Browser-Baum,
Zeitleiste, Prüfwerkzeuge). Enthalten ist eine funktionierende Beispiel-Baugruppe:
ein **Hängeschrank** (Korpus mit Dübelverbindung, eingenuteter Rückwand,
Einlegeböden und optionaler Tür).

![Stack](https://img.shields.io/badge/Stack-Vite%20%2B%20TypeScript%20%2B%20Three.js-blue)

## Funktionen

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

66 Prüfungen: Rendering, Intro-Animation, Stückliste, CSV-Inhalt, PNG-Export,
Parameter-Clamping, Randkonfigurationen (0 Böden / keine Tür), Materialwechsel,
Explosion, Bemassung, Auswahl/Abwahl, ViewCube, Ortho-Projektion, Browser-Baum
(Auswahl + Sichtbarkeit), Zeitleiste, Messen, Schnittansicht, Kamera-Presets,
Beschläge-Bibliothek, Werkzeichnung (Inhalt + SVG-Download), Zuschnittplan
(Inhalt + DXF-Download), GLB-Export, Konsolen-Fehler.
Falls Playwright-Browser nicht installiert sind: `npx playwright install chromium`
oder `CHROMIUM_PATH=/pfad/zu/chrome npm run test:e2e`.

Der Build verwendet relative Pfade (`base: './'`) und läuft daher ohne Anpassung
auf jedem statischen Hosting (GitHub Pages, Netlify, nginx, …).

## Projektstruktur

```
src/
  core/
    types.ts      Datenmodell (PartSpec, Assembly, Parameter, Beschläge)
    cabinet.ts    Parametrischer Hängeschrank (Beispiel-Baugruppe)
    hardware.ts   Beschläge-Bibliothek (Scharniere, Griffe, Träger, Aufhänger)
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
