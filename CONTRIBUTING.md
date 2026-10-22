# Contributing to Doocide

Thanks for being here. Doocide is a free decision tool that runs entirely on people's own devices, and every contribution keeps it that way: no servers, no accounts, no tracking.

## Ways to help

- 🌍 **Translate.** One file per language. See [Add a language](#add-a-language).
- 🧩 **Add a template.** A decision people make often, set up so others can score it. See [Add a template](#add-a-template).
- 🛠️ **Write code.** Pick an open issue, or something from the roadmap in the [README](README.md#roadmap).
- 🐞 **Report a bug.** Open an issue with what you did, what you expected and what happened. Privacy or security problems go to the Security tab instead, privately.
- 💬 **Tell us what you decided.** Real stories make the templates better.

## Set up

Requires Node 20.19+ and npm 11 (Node 24 includes it).

```bash
npm install
npm run dev
```

Before you open a pull request:

```bash
npm run check
```

That runs the type check, both builds and every test, including the privacy rules.

## Ground rules

These keep Doocide trustworthy. A pull request that breaks one isn't merged, however good the rest is.

- **Nothing leaves the device unless the user shares it.** No analytics, telemetry, remote fonts, third-party scripts or network calls the user didn't start.
- **Private notes stay private.** Every share goes through `src/format/share.ts`, every file written to a shared folder through `src/app/folder.ts`, and the tests in `tests/privacy.test.ts` prove it.
- **Treat incoming links and files as hostile.** Plain text only, size limits, strict checks. That includes invites, ballots and results files from a shared folder: check the signature before trusting any of it.
- **One door for each risky thing.** Network calls only in `src/app/net.ts`, WebCrypto only in `src/format/crypto.ts`, shared folders only in `src/app/folder.ts`, localStorage only in `src/app/prefs.ts`. `tests/source.test.ts` checks it.
- **No background work.** Doocide reads or writes a shared folder, or anything else outside the page, only when someone taps a button.
- **No home-made cryptography.** WebCrypto only, a fresh IV for every encryption, and never a passphrase or private key stored in plain text.
- **No brand or product names in anything users see:** interface text, translations, templates, examples and test data. Use stand-ins like "Car A", "Option B" or example.com.
- **No real people's names or data** in templates, tests or examples.
- **Every privacy rule has a test.** If you add a rule, add the test that fails when it breaks.

The full list lives in [CLAUDE.md](CLAUDE.md), under the "Never" sections, and [SECURITY.md](SECURITY.md) explains what they add up to.

## Add a language

1. Copy `src/i18n/locales/en.json` to your language code in lowercase, for example `es.json` or `pt-br.json`.
2. Translate every value. Keep every `{placeholder}` and every `{count, plural, …}` block; translate only the words inside the braces.
3. Translate "decide" with the plain word in your language. Only the English tagline plays on the name.
4. Add your language to `UI_LANGUAGES` in `src/i18n/languages.ts`, written in its own language: `{ code: 'es', name: 'Español' }`.
5. Run `npm test`. It fails if a key is missing, empty or has a different placeholder.
6. Update the README's "languages" badge: change its count in `tools/make-badges.mjs` and run `node tools/make-badges.mjs`.

## Add a template

1. Copy a file in `templates/` that's close to your idea, and give it a short lowercase name: `choose-a-bike.json`.
2. Set the title, options, factors and weights (1 is least important, 5 is very important). Add a `guide` to any factor where "higher is better" isn't obvious, for example "Higher = cheaper".
3. Use stand-in option names ("Option A", "Option B"), never real products, companies or people.
4. Leave `scores`, `pugh` and `notes` empty. Templates carry structure only.
5. Run `npm test`. It checks every template against the schema.

Templates are CC0 (public domain), so anyone can use them anywhere.

## Pull requests

- One change per pull request, with a short description of why it's needed.
- Keep the code style you find: plain TypeScript, React, no new UI or state libraries.
- New behavior comes with a test.

## Licenses

By contributing, you agree that your work is licensed like the folder it goes into: the app under AGPL-3.0-or-later, `src/format`, `src/engine` and `schema/` under MIT, and `templates/` under CC0.

## Be kind

Assume good intent, explain instead of correcting, and remember that someone on the other side is deciding something that matters to them.
