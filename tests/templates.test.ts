import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { parseEnvelopeText } from '../src/format/validate';

const root = new URL('..', import.meta.url).pathname;
const dir = join(root, 'templates');
const names = readdirSync(dir).filter((f) => f.endsWith('.json'));
const schema = JSON.parse(readFileSync(join(root, 'schema/doocide-v1.schema.json'), 'utf8'));
const validateSchema = new Ajv({ allErrors: true, strict: false }).compile(schema);

describe('templates', () => {
  it('has templates', () => expect(names.length).toBeGreaterThan(3));

  for (const file of names) {
    it(`${file} is a clean template`, () => {
      expect(file).toMatch(/^[a-z0-9-]{1,64}\.json$/);
      const text = readFileSync(join(dir, file), 'utf8');
      const raw = JSON.parse(text);
      expect(validateSchema(raw), JSON.stringify(validateSchema.errors)).toBe(true);
      const env = parseEnvelopeText(text);
      expect(env.kind).toBe('template');
      expect(env.data.scores).toEqual([]);
      expect(env.data.notes).toEqual([]);
      expect(env.data.options.length).toBeGreaterThan(1);
      expect(env.data.factors.length).toBeGreaterThan(0);
      // The validator would silently fix problems; a template should need no fixing.
      expect(env.data).toEqual(raw.data);
    });
  }
});
