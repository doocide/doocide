// Offline build: every pack is embedded in the single HTML file, so it works with no network at all.

const locales = import.meta.glob('../i18n/locales/*.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const templates = import.meta.glob('../../templates/*.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.json$/, '');
const byName = (files: Record<string, string>) => new Map(Object.entries(files).map(([path, text]) => [baseName(path), text]));

const localeTexts = byName(locales);
const templateTexts = byName(templates);
templateTexts.delete('index');

export const loadLocaleText = async (code: string) => localeTexts.get(code.toLowerCase()) ?? null;

export const loadTemplateText = async (name: string) => templateTexts.get(name) ?? null;

export async function loadTemplateIndexText(): Promise<string> {
  const index = [...templateTexts].map(([name, text]) => {
    const env = JSON.parse(text);
    return {
      name,
      title: String(env.data?.title ?? name),
      lang: String(env.data?.lang ?? 'en'),
      options: env.data?.options?.length ?? 0,
      factors: env.data?.factors?.length ?? 0,
    };
  });
  return JSON.stringify(index.sort((a, b) => a.name.localeCompare(b.name)));
}
