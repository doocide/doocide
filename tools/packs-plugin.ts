import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

const root = new URL('..', import.meta.url).pathname;
const LOCALES = join(root, 'src/i18n/locales');
const TEMPLATES = join(root, 'templates');

const jsonFiles = (dir: string) => readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();

/** Template list shown in the app: name, title, number of options and factors. */
export function templateIndex() {
  return jsonFiles(TEMPLATES).map((file) => {
    const env = JSON.parse(readFileSync(join(TEMPLATES, file), 'utf8'));
    return {
      name: file.replace(/\.json$/, ''),
      title: String(env.data?.title ?? file),
      lang: String(env.data?.lang ?? 'en'),
      options: env.data?.options?.length ?? 0,
      factors: env.data?.factors?.length ?? 0,
    };
  });
}

/** Emits language packs and templates next to index.html, so the online app loads them on demand. */
export function staticPacks(): Plugin {
  return {
    name: 'doocide-static-packs',
    apply: 'build',
    generateBundle() {
      for (const file of jsonFiles(LOCALES)) {
        this.emitFile({ type: 'asset', fileName: `locales/${file}`, source: readFileSync(join(LOCALES, file), 'utf8') });
      }
      for (const file of jsonFiles(TEMPLATES)) {
        this.emitFile({ type: 'asset', fileName: `templates/${file}`, source: readFileSync(join(TEMPLATES, file), 'utf8') });
      }
      this.emitFile({ type: 'asset', fileName: 'templates/index.json', source: JSON.stringify(templateIndex()) });
      // Published so the schema's $id resolves and AI tools can read the format.
      this.emitFile({ type: 'asset', fileName: 'schema/doocide-v1.schema.json', source: readFileSync(join(root, 'schema/doocide-v1.schema.json'), 'utf8') });
    },
  };
}
