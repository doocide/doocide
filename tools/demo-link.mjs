// The README's example decision lives in docs/assets/summer-trip.doocide.
// After editing that file, run:  node tools/demo-link.mjs --update-readme
// It rebuilds the share link (same format as src/format/codec.ts) and rewrites every
// "https://doocide.github.io/#d=…" link in README.md. Without the flag it only prints the link.
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';

const env = JSON.parse(readFileSync('docs/assets/summer-trip.doocide', 'utf8'));
if (env.kind !== 'decision' || env.data.notes.some((n) => n.visibility !== 'shared')) {
  throw new Error('The example must be a shared decision with no private notes');
}
const payload = deflateRawSync(Buffer.from(JSON.stringify(env)))
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '');
const link = `https://doocide.github.io/#d=${payload}`;

if (process.argv.includes('--update-readme')) {
  const readme = readFileSync('README.md', 'utf8');
  const updated = readme.replace(/https:\/\/doocide\.github\.io\/#d=[A-Za-z0-9_-]+/g, link);
  writeFileSync('README.md', updated);
  console.log(updated === readme ? 'README already up to date' : 'README links updated');
} else {
  console.log(link);
}
