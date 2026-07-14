import { defineConfig } from 'vite';

export default defineConfig({
  // Relativer Basis-Pfad, damit der Build unter jedem Unterverzeichnis
  // (z.B. GitHub Pages) ohne Anpassung funktioniert.
  base: './',
  build: { target: 'es2022' },
});
