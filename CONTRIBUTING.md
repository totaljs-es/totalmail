# Contributing to TotalMail

Thank you for helping. TotalMail is small on purpose: one process, an embedded database, no outside services. A good change keeps it that way.

## Run it

```bash
git clone https://github.com/totaljs-es/totalmail
cd totalmail
npm ci
node index.js 8000
```

Open <http://127.0.0.1:8000> and create the administrator. Everything the app stores is in `database/` (never committed).

## Before you open a pull request

```bash
npm run format    # the style of the Total.js guidelines, applied by ESLint --fix
npm run lint
npm test
```

The three must pass; CI runs them on Node 22 and 24 and builds the Docker image. A change that fixes a bug comes with a test that fails without it. Most tests run real IMAP, SMTP and TLS conversations against local servers (no network, no real mailbox): look at `tests/imap-protocol.test.js` or `tests/diagnose.test.js` for the pattern. Tests need the `openssl` command.

## How the code is organised

- `plugins/<name>/` is one part of the application: `actions/` (the API, written as Total.js actions), `views/` and `public/` (the browser side), `index.js`.
- `modules/` are Total.js modules loaded by name (`MODS.name`); `lib/` contains the domain logic loaded with `require()`. Tests bootstrap `total5` so framework helpers and the embedded database are exercised too.
- Data lives in the NoSQL tables of Total.js through `lib/mirror.js`: state in memory, only the records that changed are written.
- The browser code does not touch the DOM by hand: each window keeps its state in a jComponent model and the views bind to it with `ui-bind` and components. The rules a tool can check are in `eslint.config.cjs`; the full style is the [Total.js guidelines](https://github.com/totaljs-es/guidelines).
- Use what Total.js already gives (`Total.Fs`, `Total.Path`, `Total.Crypto`, `NOSQL`, `NEWACTION`, `MODS`) instead of an extra package.

Startup uses `LOADCONFIG()` and `CONF`, then `Total.run()`. Keep `config` limited to public defaults; credentials belong to the encrypted instance settings. Use native helpers where their behavior matches the contract, and keep strict parsing, atomic writes and cryptographic primitives where their exact semantics matter.

## Texts and languages

Every text the person sees is written as `@(Text)` in code and views, with no parentheses inside. Run `node bin/translations.js` to see what is missing in each `resources/<language>.resource`, and `node bin/translations.js --add` to add the English text to every file so you can translate it. A test fails if a text has no translation. To add a language, copy `resources/en.resource` to `resources/<code>.resource` and translate it.

## Things we do not accept

These are decisions, not oversights:

- **No AI that reads mail and acts.** An email is written by someone else and can hide instructions. The writing assistant works on one text, on request, with no tools, and its answer is only a suggestion (see `docs/assistant.md`). No agents, no MCP server, no automatic runs.
- **No sending without review.** Every message passes the review step.
- **No outside services** (analytics, fonts, CDNs for data). The only external address the page loads from is the Total.js component CDN.
- **No secrets in the repository or in the browser**: `config` holds only public defaults; mail passwords, OAuth secrets and assistant keys are encrypted in the database.

## Reporting a security problem

Please do not open a public issue: see [SECURITY.md](SECURITY.md).
