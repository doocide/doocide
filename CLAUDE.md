# Doocide

Free, local-first decision tool based on the Pugh Matrix. No server, no accounts, no analytics. Revival of doocide.com (2008–2010 web app, then a mobile app).

## Status

Milestone 1 released as v0.1.0 (2026-10-20), live at https://doocide.github.io: solo decisions, share links and files, paste-a-table import, CSV export, private/shared notes, facts, EN + RO.

Milestone 2a tagged v0.2.0 (2026-10-20), not yet released to the site: invites and ballots by link or file, organizer approval, anonymous or named ballots (locked after the first ballot), blind or open scoring, combined results (average or median), a disagreement list, and a group results share.

Next: the rest of milestone 2 in order: 2b signatures and short-code verification, 2c passphrase and sealed encryption plus the optional library lock, 2d collecting ballots through a synced cloud folder. Then milestone 3 (AI copy-prompt and MCP, public sharing, room mode with QR codes, decision journal, ~35 languages).

## Stack and commands

React 19 + TypeScript 7 + Vite 8, built into one HTML file (vite-plugin-singlefile). No UI or state libraries; plain CSS with tokens in `src/styles.css`, using StudentGrader's colors. Source in `doocide/doocide`; each published release is copied by `.github/workflows/pages.yml` into `doocide/doocide.github.io`, served at https://doocide.github.io (owner setup and release checklist: `sandbox/maintainer/publishing.md`, local and gitignored). Both repos stay public.

- `npm run dev`: dev server (no security policy in dev; check it with the build).
- `npm run build`: `dist/index.html` + `dist/locales/*.json` + `dist/templates/*.json`, plus `dist/doocide.html` (offline, every pack embedded).
- `npm test`: vitest. `REQUIRE_BUILD=1 npm test` also checks the built pages (CI does this).
- npm 10 fails to resolve Vite 8 (an npm resolver bug). Use npm 11 (Node 24 includes it, or `npx npm@11 install`).

## Layout and licenses

- `src/format/` (MIT): file format, checks (`validate.ts`), cleaning (`sanitize.ts`), links (`codec.ts`), the only share path (`share.ts`), tables and CSV.
- `src/engine/` (MIT): scoring and sensitivity ("what flips the winner").
- `src/app/` (AGPL): the UI. `net.ts` is the only file allowed to call `fetch`; `prefs.ts` the only one allowed to use localStorage.
- `src/i18n/`: language system; packs in `src/i18n/locales/*.json`, list in `languages.ts`.
- `src/packs/`: `remote.ts` (online, fetch packs on demand) or `embedded.ts` (offline build), chosen by Vite alias `@packs`.
- `tools/`: build plugins (security policy hashes, static packs).
- `schema/` (MIT): JSON Schema. `templates/` (CC0): starter templates.
- `docs/assets/`: README logo and screenshots. The example decision `summer-trip.doocide` drives the README's example link and every screenshot; when the UI changes visibly, refresh them with `sandbox/maintainer/screenshots.md` (local, gitignored) and `node tools/demo-link.mjs --update-readme`.
- `tests/`: `privacy.test.ts` and `input.test.ts` enforce the never-lists below; `group.test.ts` checks merging and the ballot checks; `build.test.ts` checks the built pages.

The app is AGPL-3.0-or-later. The file format, schema, templates and scoring engine are MIT or CC0, so other tools can adopt them.

## Never: privacy rules

Breaking one of these is a bug, not a style issue. Each needs an automated test that fails the build.

"Shared output" means: ballot, template link, public share, QR code, a file written to a shared or synced folder, clipboard share, AI prompt.

- Never put private notes in any shared output. Private notes stay in the user's local store, never in a shared or synced folder.
- Never put a name or identity in an anonymous ballot. Leave the field out entirely; hiding it isn't enough. No stable device ID, and no long-lived signing key that links anonymous ballots together. Use a throwaway key per decision, or no signature.
- Never let the anonymity setting change after the first ballot exists.
- Never put decision data in the URL path or query string. Only after `#`, which browsers don't send to servers.
- Never make a network call the user didn't start. The only exceptions are loading the app, its language packs and its templates, all from the app's own origin. No analytics, telemetry, error reporting, remote fonts or third-party scripts.
- Never send anything to an AI automatically. AI use goes through copy-prompt or the user's own AI client. Private notes are left out unless the user ticks the box for that prompt.
- Never share without a preview that lists exactly what's included.
- Never trust an incoming link or file. See "Never: incoming links and files" below.
- Never turn on GitHub Pages for any other repo in the `doocide` organization. Every Pages site there is served from `doocide.github.io`, the same address, so it would share Doocide's storage and could read users' decisions. See the owner checklist in `sandbox/maintainer/publishing.md`.
- Never store a passphrase or private key in plain text. Never write our own crypto (use WebCrypto only), and never reuse an IV.

## Never: incoming links and files

Treat every link, file, pasted table and ballot from someone else as hostile.

- Never render incoming content as HTML. Plain text only: no `dangerouslySetInnerHTML`, no unsanitized Markdown. Ship a strict Content-Security-Policy in the HTML: hashed inline scripts, and `connect-src 'self'` only.
- Never fetch an address that comes from link or file data. Templates load only by name (`#t=name`) from the app's own `templates/` folder. No remote images.
- Never let a link perform an action. Links carry data only, and URLs never carry settings or commands. An incoming decision opens as a read-only preview. Saving it, or adding a ballot to a decision, needs the user's tap.
- Never let someone else's content look like app UI. Show it in a marked frame with the author named, and don't let it use the app's warning styles. The app never asks for passwords, payment or personal info.
- Never keep direction-override characters (U+202A–U+202E, U+2066–U+2069) or invisible characters (U+200B, U+2060, U+FEFF) in incoming text, and cap stacked combining marks. Keep ZWNJ and ZWJ (U+200C, U+200D): Persian, Indic scripts and emoji need them. Real right-to-left text must keep working: isolate each field with `dir="auto"` or `<bdi>`.
- Never make a link clickable unless it's http/https. Show the real domain beside it, flag domains that mix alphabets (look-alike letters), and confirm before opening. Open it with `rel="noopener noreferrer"`.
- Never parse without limits. Cap link length, payload size, unpacked size (abort while unpacking), counts, field lengths and nesting depth. Validate against the schema into fresh objects, so no `__proto__` pollution. If the file's format version is newer than the app understands, show "Made with a newer Doocide" instead of guessing.
- Never export a cell that starts with `=`, `+`, `-` or `@` to CSV or XLSX unescaped. Prefix it with `'`.
- Never put decision content in an AI prompt without wrapping it as untrusted data from its author. Warn when the content reads like instructions to an AI.

## Never: signatures and anonymity

- Never sign an anonymous ballot with a long-lived key. Anonymous mode uses a fresh key made for that one decision. Attributed mode uses the person's long-lived device key.
- Never reuse a per-decision key in another decision, and never derive it from the long-lived key.
- Never show a name as verified unless its signature checks out against a key the group confirmed by comparing short codes. Otherwise label the name "self-declared".
- Never merge a ballot without the organizer's approval. Flag likely duplicates, and flag when ballots outnumber the expected participant count.
- Never accept an invite code (the random QR cards) twice, and never record which person received which code.
- Never describe anonymous mode as more than it is. Ballots are anonymous to other participants and to anyone who sees the results or the shared folder, but not necessarily to whoever collects them.

## Never: brand names where users see them

- Never put brand or product names in anything users see: interface text, translations, templates, example and test data, marketing, commit messages. Use stand-ins like "Car A", "Option B", "any spreadsheet app", "a mobile app", example.com.
- Factual product names are fine in developer-only places: code comments, test names, the README's build and browser-support notes, and the maintainer notes in `sandbox/`. Example: "Chrome returns 'cancel' from confirm() without showing it".
- Always fine: Claude, the Pugh Matrix and Stuart Pugh, Doocide, StudentGrader. Repo addresses and required technical identifiers stay as they are.

## Never: committing

- Never commit `sandbox/`, real decisions, real people's names or data, or keys. Tests and templates use made-up data.
