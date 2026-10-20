// Online build: packs are separate files next to index.html, fetched when first needed.
import { fetchPack } from '../app/net';

export const loadLocaleText = (code: string) => fetchPack(`locales/${code.toLowerCase()}.json`);
export const loadTemplateIndexText = () => fetchPack('templates/index.json');
export const loadTemplateText = (name: string) => fetchPack(`templates/${name}.json`);
