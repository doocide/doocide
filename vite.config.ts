import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { contentSecurityPolicy } from './tools/csp-plugin.ts';
import { staticPacks } from './tools/packs-plugin.ts';

// Two builds from one source:
// - default: dist/index.html (single file) + locales/ and templates/ as separate JSON packs,
//   loaded on demand from the same origin (GitHub Pages).
// - offline: one self-contained HTML file with every pack embedded (copied to dist/doocide.html).
export default defineConfig(({ mode }) => {
  const offline = mode === 'offline';
  const packs = offline ? './src/packs/embedded.ts' : './src/packs/remote.ts';
  return {
    base: './',
    plugins: [react(), viteSingleFile(), contentSecurityPolicy(), offline ? null : staticPacks()],
    resolve: {
      alias: { '@packs': fileURLToPath(new URL(packs, import.meta.url)) },
    },
    define: {
      __OFFLINE__: JSON.stringify(offline),
    },
    build: {
      outDir: offline ? 'dist-offline' : 'dist',
      emptyOutDir: true,
      sourcemap: false,
    },
  };
});
