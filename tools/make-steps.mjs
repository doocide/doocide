// Draws the README's "how it works" diagram in light and dark versions:
// docs/assets/how-it-works.svg and how-it-works-dark.svg.  Run: node tools/make-steps.mjs
import { writeFileSync } from 'node:fs';

const themes = {
  light: { file: 'how-it-works.svg', card: '#f6f8fa', edge: '#d0d7de', title: '#1f2328', sub: '#59636e', track: '#c4c4c4', arrow: '#8c959f', knob: '#38761d' },
  dark: { file: 'how-it-works-dark.svg', card: '#161b22', edge: '#30363d', title: '#e6edf3', sub: '#9198a1', track: '#484f58', arrow: '#6e7681', knob: '#6aa84f' },
};

const steps = [
  {
    color: '#3c78d8',
    ink: '#ffffff',
    lines: ['Pick a tough', 'decision.'],
    sub: 'two or more options',
    // A path that splits toward two options.
    icon: (t) => `<path d="M20 38V24M20 24L10 13M20 24L30 13" fill="none" stroke="#3c78d8" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="9" cy="10" r="4.5" fill="#3c78d8"/><circle cx="31" cy="10" r="4.5" fill="#3c78d8"/>`,
  },
  {
    color: '#38761d',
    ink: '#ffffff',
    lines: ['Set up your options', 'and factors.'],
    sub: 'weigh what matters, then score',
    // Three sliders at different settings.
    icon: (t) => `<path d="M9 5v30M20 5v30M31 5v30" stroke="${t.track}" stroke-width="3" stroke-linecap="round"/>
      <circle cx="9" cy="20" r="4.5" fill="${t.knob}"/><circle cx="20" cy="29" r="4.5" fill="${t.knob}"/><circle cx="31" cy="11" r="4.5" fill="${t.knob}"/>`,
  },
  {
    color: '#f1c232',
    ink: '#3d3200',
    lines: ['Compare and reveal', 'the winner!'],
    sub: 'and see how solid it is',
    // The logo's green confirm button.
    icon: () => `<circle cx="20" cy="20" r="16" fill="#40c057"/>
      <path d="M12.5 20.5l5 5l10-11" fill="none" stroke="#ffffff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
];

const W = 800;
const H = 200;
const CARD_W = 232;
const CARD_X = [8, 284, 560];

for (const t of Object.values(themes)) {
  const cards = steps
    .map((s, i) => {
      const x = CARD_X[i];
      return `
  <g transform="translate(${x} 8)">
    <rect width="${CARD_W}" height="184" rx="18" fill="${t.card}" stroke="${t.edge}" stroke-width="1.5"/>
    <circle cx="38" cy="40" r="18" fill="${s.color}"/>
    <text x="38" y="41" text-anchor="middle" dominant-baseline="central" font-size="18" font-weight="800" fill="${s.ink}">${i + 1}</text>
    <g transform="translate(${CARD_W - 64} 20)">${s.icon(t)}</g>
    <text x="24" y="98" font-size="17" font-weight="800" fill="${t.title}">${s.lines[0]}</text>
    <text x="24" y="121" font-size="17" font-weight="800" fill="${t.title}">${s.lines[1]}</text>
    <text x="24" y="156" font-size="13" font-weight="500" fill="${t.sub}">${s.sub}</text>
  </g>`;
    })
    .join('');
  const arrows = [262, 538]
    .map((x) => `\n  <path d="M${x - 5} 88l9 12l-9 12" fill="none" stroke="${t.arrow}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`)
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="How it works: 1. Pick a tough decision. 2. Set up your options and factors. 3. Compare and reveal the winner!" font-family="system-ui, sans-serif">${cards}${arrows}
</svg>
`;
  writeFileSync(`docs/assets/${t.file}`, svg);
  console.log(`docs/assets/${t.file}`);
}
