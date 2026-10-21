// Hard limits for anything that comes from outside: links, files, pasted tables.
// Generous for real decisions, small enough that a hostile payload can't hang the page.

/** PBKDF2 iterations: what Doocide uses, and the range it accepts from a file. */
export const ITERATIONS = { default: 600_000, min: 100_000, max: 2_000_000 } as const;

export const LIMITS = {
  /** Encoded payload after "#d=" in a link. */
  linkChars: 400_000,
  /** A .doocide file or a template pack. */
  fileBytes: 2_000_000,
  /** JSON text after unpacking a link. */
  unpackedBytes: 2_000_000,
  /** Deepest allowed nesting of JSON objects and arrays. */
  depth: 8,
  options: 100,
  factors: 300,
  facts: 10_000,
  scores: 30_000,
  notes: 5_000,
  translations: 60,
  pastedTableChars: 500_000,
  /** Approved ballots kept in one group decision. */
  ballots: 1_000,
  /** Highest re-send count a ballot may claim. */
  revision: 1_000_000,
  /** Highest "people expected" an organizer can set. */
  expected: 1_000,
  text: {
    id: 64,
    lang: 35,
    title: 200,
    name: 200,
    description: 2_000,
    guide: 1_000,
    fact: 1_000,
    url: 2_000,
    note: 4_000,
    author: 80,
    /** A public key or a signature, base64url. P-256: 87 and 86 characters. */
    key: 120,
  },
} as const;
