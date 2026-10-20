// A small ICU MessageFormat subset: {name} and {count, plural, one {# item} other {# items}}.

export type Vars = Record<string, string | number>;

function matchingBrace(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

function pluralBranches(body: string): Map<string, string> {
  const branches = new Map<string, string>();
  let i = 0;
  while (i < body.length) {
    const open = body.indexOf('{', i);
    if (open < 0) break;
    const selector = body.slice(i, open).trim();
    const close = matchingBrace(body, open);
    if (close < 0) break;
    branches.set(selector, body.slice(open + 1, close));
    i = close + 1;
  }
  return branches;
}

export function formatMessage(template: string, vars: Vars | undefined, lang: string): string {
  let out = '';
  let i = 0;
  while (i < template.length) {
    const open = template.indexOf('{', i);
    if (open < 0) {
      out += template.slice(i);
      break;
    }
    out += template.slice(i, open);
    const close = matchingBrace(template, open);
    if (close < 0) {
      out += template.slice(open);
      break;
    }
    const inner = template.slice(open + 1, close);
    const plural = /^\s*(\w+)\s*,\s*plural\s*,([\s\S]*)$/.exec(inner);
    if (plural) {
      const n = Number(vars?.[plural[1]!] ?? 0);
      const branches = pluralBranches(plural[2]!);
      const category = new Intl.PluralRules(lang).select(n);
      const chosen = branches.get(`=${n}`) ?? branches.get(category) ?? branches.get('other') ?? '';
      out += formatMessage(chosen.replace(/#/g, new Intl.NumberFormat(lang).format(n)), vars, lang);
    } else {
      const value = vars?.[inner.trim()];
      out += value === undefined ? `{${inner}}` : typeof value === 'number' ? new Intl.NumberFormat(lang).format(value) : value;
    }
    i = close + 1;
  }
  return out;
}
