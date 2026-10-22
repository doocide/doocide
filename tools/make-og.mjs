// Draws the link preview image (public/og.png, 1200 x 630) that chat apps and social sites show
// next to a shared link. It's the same for every link: the decision itself sits after "#", which
// preview services never see. Re-run after changing the logo or the wording:
//
//   node tools/make-og.mjs
//
// Renders with headless Chrome (set CHROME to its path if it isn't in the usual place on macOS).

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const logo = readFileSync('docs/assets/logo.svg', 'utf8').replace(/width="120" height="120"/, 'width="300" height="300"');

const html = `<!doctype html>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: #ffffff; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a; }
  .card { position: absolute; inset: 0 0 54px 0; display: flex; align-items: center; justify-content: center; gap: 56px; }
  h1 { margin: 0; font-size: 132px; line-height: 1; font-weight: 800; letter-spacing: -3px; }
  p { margin: 18px 0 0; font-size: 44px; color: #434343; }
  .small { margin-top: 26px; font-size: 30px; color: #666666; }
  .rows { position: absolute; left: 0; right: 0; bottom: 0; display: flex; height: 54px; }
  .rows div { flex: 1; }
</style>
<div class="card">
  ${logo}
  <div>
    <h1>doocide</h1>
    <p>It's time to doocide.</p>
    <p class="small">No server. No accounts. No tracking.</p>
  </div>
</div>
<div class="rows"><div style="background:#4a86e8"></div><div style="background:#6aa84f"></div><div style="background:#f1c232"></div></div>`;

const dir = mkdtempSync(join(tmpdir(), 'doocide-og-'));
try {
  const page = join(dir, 'og.html');
  writeFileSync(page, html);
  mkdirSync('public', { recursive: true });
  const out = resolve('public/og.png');
  execFileSync(CHROME, ['--headless=new', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1200,630', `--screenshot=${out}`, `file://${page}`], { stdio: 'ignore' });
  console.log('wrote public/og.png');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
