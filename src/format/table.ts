// Paste-a-table import (from any spreadsheet app) and CSV export.

import { newId } from './ids';
import { LIMITS } from './limits';
import { cleanText, escapeSpreadsheetText } from './sanitize';
import type { Decision, Fact, Score } from './types';
import { FormatError } from './validate';

/** Splits pasted text into rows and cells. Tabs if any line has one, else commas or semicolons. */
export function parseTable(text: string): string[][] {
  if (text.length > LIMITS.pastedTableChars) throw new FormatError('too-big');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = firstLine.includes('\t') ? '\t' : firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export interface TableImport {
  /** true: the first row names the options (one option per column). false: the first column does. */
  optionsInColumns: boolean;
  scaleMax: number;
}

/**
 * Builds a decision from a table. The header names the options, the other axis names the factors.
 * If every filled cell is a number within the scale, cells become scores; otherwise they become facts.
 */
export function tableToDecision(rows: string[][], opts: TableImport, base: Decision): Decision {
  const grid = opts.optionsInColumns ? rows : transpose(rows);
  const header = grid[0] ?? [];
  const optionNames = header.slice(1).map((n) => cleanText(n, LIMITS.text.name));
  const body = grid.slice(1).filter((r) => cleanText(r[0], LIMITS.text.name));
  if (optionNames.length > LIMITS.options || body.length > LIMITS.factors) throw new FormatError('too-big');

  const options = optionNames.map((name, i) => ({ id: newId(), name: name || `Option ${i + 1}` }));
  const factors = body.map((r) => ({ id: newId(), name: cleanText(r[0], LIMITS.text.name), weight: 3 }));

  const cells: { optionId: string; factorId: string; text: string }[] = [];
  body.forEach((r, fi) => {
    options.forEach((o, oi) => {
      const text = cleanText(r[oi + 1], LIMITS.text.fact, true);
      if (text) cells.push({ optionId: o.id, factorId: factors[fi]!.id, text });
    });
  });

  const asNumber = (t: string) => Number(t.replace(',', '.'));
  const allScores =
    cells.length > 0 &&
    cells.every((c) => {
      const n = asNumber(c.text);
      return Number.isFinite(n) && n >= 0 && n <= opts.scaleMax;
    });

  const scores: Score[] = allScores ? cells.map((c) => ({ optionId: c.optionId, factorId: c.factorId, value: asNumber(c.text) })) : [];
  const facts: Fact[] = allScores ? [] : cells.map((c) => ({ optionId: c.optionId, factorId: c.factorId, text: c.text }));

  return {
    ...base,
    settings: { ...base.settings, mode: 'weighted', scaleMax: opts.scaleMax },
    options,
    factors,
    facts,
    scores,
    pugh: [],
    notes: [],
  };
}

function transpose(rows: string[][]): string[][] {
  const width = Math.max(0, ...rows.map((r) => r.length));
  return Array.from({ length: width }, (_, c) => rows.map((r) => r[c] ?? ''));
}

function csvCell(value: string | number): string {
  if (typeof value === 'number') return String(value);
  const text = escapeSpreadsheetText(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Factors as rows, options as columns, then a totals row. Text is escaped against formulas. */
export function toCSV(d: Decision, totals: Map<string, number>, labels: { factor: string; weight: string; total: string }): string {
  const pugh = d.settings.mode === 'pugh';
  const source = pugh ? d.pugh : d.scores;
  const value = new Map(source.map((s) => [`${s.optionId} ${s.factorId}`, s.value]));
  const lines: (string | number)[][] = [[labels.factor, labels.weight, ...d.options.map((o) => o.name)]];
  for (const f of d.factors) {
    lines.push([f.name, f.weight, ...d.options.map((o) => value.get(`${o.id} ${f.id}`) ?? '')]);
  }
  lines.push([labels.total, '', ...d.options.map((o) => totals.get(o.id) ?? '')]);
  return lines.map((l) => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
