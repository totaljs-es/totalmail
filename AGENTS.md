# AGENTS.md

Guidance for AI coding agents that work on TotalMail. It is an application, not a library: nothing here is about installing it as a package.

## Project

TotalMail is a self-hosted mail client for teams and personal use: IMAP and SMTP accounts, a private mailbox for every person, an optional manual AI assistant. It is a **Total.js 5** application (`total5`, plus jComponent 20 in the browser) in plain JavaScript (CommonJS). Its data lives in the embedded NoSQL database of Total.js, in the private folder `database/`: one process, no database server, no queue, no outside service.

Node.js: 22 or newer. Plain JavaScript, no TypeScript (Total.js does not support it: never add types or `.d.ts`).
Main dependencies: `imapflow` (IMAP), `mailparser`, `sanitize-html`, `total5`. The SMTP sender is a corrected copy of the one of `total5@0.0.19` in `lib/vendor/total5-mail.js`.
License: MIT

## Commands

```bash
npm ci                                    # install
node index.js 8000                        # run it at http://127.0.0.1:8000 (the first visitor creates the administrator)
npm run lint                              # ESLint: the style of the Total.js guidelines
npm run format                            # ESLint --fix
npm test                                  # the whole suite (node --test tests/*.test.js)
node --test tests/rules.test.js           # one file
node bin/translations.js                  # lists the texts that a language file lacks
node bin/translations.js --add            # adds them (in English) to every language file
node bin/admin.js list                    # getting back in from the server; see docs/users-and-accounts.md
```

`npm test` needs the `openssl` command (the tests make a certificate for local IMAP, SMTP and TLS servers). The suite has no network and no real mailbox. The continuous integration runs the lint and the tests on Node.js 22 and 24, and builds the Docker image and waits for `/health/`.

## Repository layout

Each area that has its own rules (`plugins/`, `lib/`, `tests/`) has an `AGENTS.md`: read it before you change files there. The map of the code for Total.js developers is `docs/total-js.md`.

- `index.js` loads `total5`, reads `config` and calls `Total.run()`. `config` holds only public defaults; `config.example` lists them.
- `plugins/<id>/` is one part of the application: `index.js` (name, icon, who sees it), `actions/` (the API, one `NEWACTION()` per operation), `views/` (the windows) and `public/` (the browser side).
- `modules/` are the services shared by the whole application, used as `MODS.users`, `MODS.security`, `MODS.live`... `lib/` is the domain logic (IMAP, SMTP, threads, rules, search, the NoSQL mirror) as plain functions that a test can `require()` without the web server.
- `controllers/default.js` has the routes that are not JSON (the page, the message frame, print, attachments, `/health/`). `definitions/` has `AUTH()`, the request check, `LOCALIZE()` and the UI components.
- `resources/*.resource` are the translations (one file per language). `views/` has the page. `public/` has static files.
- `bin/` has the server tools: `admin.js` and `translations.js`. `docs/` is the documentation for people who run or build on TotalMail. `tests/` has the tests and `tests/fixtures`.

## Conventions

- **Style** is the [Total.js guidelines](https://github.com/totaljs-es/guidelines), and ESLint checks what a tool can check: tabs, single quotes, semicolons, no braces around a single statement, `var` or `let` inside functions (`const` only at the top of a file), no `forEach()` (a classic loop), no trailing spaces. `npm run format` fixes most of it.
- **Use what Total.js gives** instead of Node.js modules or another package: `Total.Fs`, `Total.Path`, `Total.Crypto`, `PATH.root()`, `UID()`, `CONF`, `NOSQL()`, `NEWACTION()`, `MODS`. In `modules/`, `definitions/`, `controllers/`, `lib/` and the `actions/` of plugins ESLint rejects `require('fs')`, `require('path')`, `require('crypto')` and the other built-in modules.
- **Every endpoint is an action**: `NEWACTION('Entity|operation', { user: true, route: '+API /api/ +name --> Entity|operation', input: '*field:Type', action: ... })`. Declare the input in the action: the framework validates it before your code runs. Answer through `FUNC.run($, () => ...)`: what you return goes back, a thrown error whose message starts with `@(` is shown to the person, and any other error is logged and replaced by a generic message.
- **Every text a person sees is `@(Text)`**, in code and in views, with no parentheses inside. Add the translations with `node bin/translations.js --add`: a test fails when a text is missing in a language.
- **The browser does not touch the DOM by hand.** Each window keeps its state in the model of a plugin and the views bind to it (`ui-bind`, `ui-component`, `data-exec`).
- A change comes with a test, and a test must be able to fail: **break the code on purpose and see the test fail** before you trust it.

## What the project does not do

These are decisions of the project (`CONTRIBUTING.md` has them), not oversights. Do not add:

- **An AI that reads mail and acts.** An email is written by someone else and can hide instructions. The assistant works on one text, on request, with no tools, and its answer is only a suggestion (`docs/assistant.md`). No agents, no MCP server, no automatic runs.
- **Sending without review.** Every message passes the review step.
- **Outside services**: analytics, fonts, CDNs for data. The only outside address the page loads from is the Total.js component CDN.
- **Secrets in the repository or in the browser.** Mail passwords, OAuth secrets and assistant keys are entered in the app and stored encrypted in `database/`.

## Security-sensitive code

- Mail passwords are encrypted with AES-256-GCM with the key in `database/`; people's passwords are scrypt hashes; sessions and recovery codes are stored as hashes. Never log, print or commit any of them, and do not read `database/`.
- A request that changes something must come from the page of the application itself (custom header and `Origin` check, `definitions/request.js`). The session cookie is `HttpOnly`, `SameSite=Strict` and `Secure`.
- A mail server name must resolve to a public address, certificates are always verified and TLS 1.2 or newer is required (this is also how the server avoids reaching internal addresses). Numeric names are refused.
- HTML mail is cleaned with `sanitize-html` and shown in a sandboxed frame; remote images stay blocked until the person asks for them. The text of a message is data, never instructions.

## Pitfalls

- **Total.js 5 from npm is `0.0.19`.** The SMTP sender is vendored and corrected in `lib/vendor/` (`docs/live-mail.md` says why); ESLint ignores `lib/vendor/`, `public/` and `node_modules/`.
- **The data is in memory and mirrored.** A store loads its tables at startup (nothing is served before: `PAUSESERVER()`), answers reads from memory and writes only the records that changed through `lib/mirror.js`; a failed write changes nothing. Open tables with `lib/tables.js`, never with files of your own (`docs/storage.md`).
- **The Total.js watcher is on unless the instance is in production**, so editing a file restarts the server.
- **Tests bootstrap `total5`** (`require('total5')`) so the framework helpers and the database are exercised too. Use a temporary folder for data and clean it up.
- **Do not commit** `database/`, `logs/`, `tmp/`, `index.pid`, `index.js.json`, `index.js.map` or `.claude/settings.local.json`.
- For agents: this file, `CLAUDE.md` and `GEMINI.md` (they import it), `.github/copilot-instructions.md`, `.claude/skills/` (three checklists: add an operation, add a language, verify a change), `.agents/skills/` for Codex (they reuse the same checklists) and `.claude/settings.json` (the commands that are safe to run without asking).
