// Draws the README's fixed badges as local SVG files (docs/assets/badge-*.svg): soft pills in
// StudentGrader's colors, a light tint with a colored dot and darker text. Re-run after changing
// text, for example when a language is added:  node tools/make-badges.mjs
import { writeFileSync } from 'node:fs';

const CHAR = 6.3; // average width of a 12px regular character
const PAD = 9;
const DOT = 7;
const GAP = 5;

const green = { tint: '#d9ead3', dot: '#38761d', ink: '#274e13' };
const gold = { tint: '#fff2cc', dot: '#bf9000', ink: '#5c4700' };
const blue = { tint: '#c9d9f8', dot: '#3c78d8', ink: '#1c4587' };
const red = { tint: '#f4cccc', dot: '#cc0000', ink: '#85200c' };

const badges = [
  { file: 'badge-tracking.svg', text: 'no tracking', ...green },
  { file: 'badge-languages.svg', text: '2 languages and counting', ...gold },
  { file: 'badge-app-license.svg', text: 'app: AGPL-3.0', ...blue },
  { file: 'badge-format-license.svg', text: 'format & templates: MIT / CC0', ...blue },
  { file: 'badge-contributions.svg', text: 'contributions welcome', ...red },
];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

for (const b of badges) {
  const tw = Math.round(b.text.length * CHAR);
  const w = PAD + DOT + GAP + tw + PAD;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="22" viewBox="0 0 ${w} 22" role="img" aria-label="${esc(b.text)}">
  <rect width="${w}" height="22" rx="11" fill="${b.tint}"/>
  <circle cx="${PAD + DOT / 2}" cy="11" r="${DOT / 2}" fill="${b.dot}"/>
  <text x="${PAD + DOT + GAP}" y="11.5" dominant-baseline="central" font-family="system-ui, sans-serif" font-size="12" font-weight="400" fill="${b.ink}" textLength="${tw}" lengthAdjust="spacingAndGlyphs">${esc(b.text)}</text>
</svg>
`;
  writeFileSync(`docs/assets/${b.file}`, svg);
  console.log(`docs/assets/${b.file} (${w}×22)`);
}
