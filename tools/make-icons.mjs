// Draws the app icons that installing Doocide as an app uses (public/icon-*.png, listed in
// public/manifest.webmanifest), from the same logo as the page's favicon. Re-run after changing it:
//
//   node tools/make-icons.mjs
//
// Renders with headless Chrome (set CHROME to its path if it isn't in the usual place on macOS).

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// The favicon's logo: three sliders settling into a check, on a dark tile.
const mark = `<g transform="translate(12 12) scale(0.8)">
  <path d="M30 16v88M60 16v88M90 16v88" stroke="#fff" stroke-opacity=".3" stroke-width="8" stroke-linecap="round"/>
  <path d="M30 64L60 88L90 34" fill="none" stroke="#6ea2ff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="30" cy="64" r="11" fill="#fff"/><circle cx="60" cy="88" r="11" fill="#fff"/>
  <circle cx="90" cy="34" r="18" fill="#40c057"/>
  <path d="M82 34l6 6l10-11" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
</g>`;

/** `rounded`: a tile with transparent corners. Otherwise full bleed, for systems that cut their own shape (the logo sits inside the safe circle). */
const svg = (rounded) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="100%" height="100%">
  <rect width="120" height="120" ${rounded ? 'rx="28"' : ''} fill="#23262d"/>${mark}</svg>`;

const icons = [
  { file: 'icon-192.png', size: 192, rounded: true },
  { file: 'icon-512.png', size: 512, rounded: true },
  { file: 'icon-maskable-512.png', size: 512, rounded: false },
  { file: 'apple-touch-icon.png', size: 180, rounded: false },
];

const dir = mkdtempSync(join(tmpdir(), 'doocide-icons-'));
try {
  for (const { file, size, rounded } of icons) {
    const page = join(dir, `${size}-${rounded}.html`);
    writeFileSync(page, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden;background:transparent}</style>${svg(rounded)}`);
    execFileSync(
      CHROME,
      ['--headless=new', '--hide-scrollbars', '--force-device-scale-factor=1', '--default-background-color=00000000', `--window-size=${size},${size}`, `--screenshot=${resolve('public', file)}`, `file://${page}`],
      { stdio: 'ignore' },
    );
    console.log(`wrote public/${file}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
