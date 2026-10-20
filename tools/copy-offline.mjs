// Copies the self-contained offline build next to the online one, so the app can offer
// "Download for offline" from the same origin.
import { copyFileSync, rmSync } from 'node:fs';

copyFileSync('dist-offline/index.html', 'dist/doocide.html');
rmSync('dist-offline', { recursive: true, force: true });
console.log('dist/doocide.html written (offline, all packs embedded)');
