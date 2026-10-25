import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { contentSecurityPolicy } from './tools/csp-plugin.ts';
import { staticPacks } from './tools/packs-plugin.ts';

/**
 * The online page can be installed as an app (public/manifest.webmanifest: icons, opening .doocide
 * files, receiving them from a phone's share menu). The offline file stays self-contained: no manifest.
 */
const installable = (): Plugin => ({
  name: 'doocide-installable',
  transformIndexHtml: (html) =>
    html.replace(
      '<title>',
      [
        '<link rel="manifest" href="manifest.webmanifest" />',
        '<link rel="apple-touch-icon" href="apple-touch-icon.png" />',
        '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f7f7f7" />',
        '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#1f1f1f" />',
        '<title>',
      ].join('\n    '),
    ),
});

// Two builds from one source:
// - default: dist/index.html (single file) + locales/ and templates/ as separate JSON packs,
//   loaded on demand from the same origin (GitHub Pages).
// - offline: one self-contained HTML file with every pack embedded (copied to dist/doocide.html).
export default defineConfig(({ mode }) => {
  const offline = mode === 'offline';
  const packs = offline ? './src/packs/embedded.ts' : './src/packs/remote.ts';
  return {
    base: './',
    plugins: [react(), offline ? null : installable(), viteSingleFile(), contentSecurityPolicy(), offline ? null : staticPacks()],
    resolve: {
      alias: { '@packs': fileURLToPath(new URL(packs, import.meta.url)) },
    },
    define: {
      __OFFLINE__: JSON.stringify(offline),
      // The one place the version lives: package.json.
      __VERSION__: JSON.stringify(JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version),
    },
    build: {
      outDir: offline ? 'dist-offline' : 'dist',
      emptyOutDir: true,
      sourcemap: false,
    },
  };
});
