# TotalMail for Total.js developers

TotalMail is a Total.js 5 application written the way the framework suggests. If you have built a Total.js project before, everything here is where you expect it. This page is the map.

## What starts the application

- `index.js` loads `total5`, reads `config` with `LOADCONFIG()` and calls `Total.run()`. The Total.js watcher is on unless the instance runs in production.
- `config` holds only public defaults (`name`, `production`, `$ip`, `trust_proxy`, `oauth_base_url`). Passwords, OAuth secrets and assistant keys are never in it: they are entered in the app and stored encrypted in `database/`.

## Where each thing lives

| Folder | What it is | Total.js feature |
| --- | --- | --- |
| `plugins/<id>/index.js` | The manifest of a part of the app: `name`, `icon`, `visible(user)` | Plugins |
| `plugins/<id>/actions/*.js` | The API of that part, one `NEWACTION()` per operation | Actions with `route`, `input`, `user`, `permissions` |
| `plugins/<id>/views/*.html` | Windows of the page, composed in `views/index.html` with `@{view('#id/views/name')}` | Plugin views |
| `plugins/<id>/public/*.js` | The browser side: `PLUGIN('id', function(exports) { ... })` | jComponent plugins |
| `controllers/default.js` | The routes that are not JSON: the page, the message frame, print, source, attachments, upload | `exports.install` + `ROUTE()` |
| `definitions/` | `AUTH()`, `LOCALIZE()`, the request middleware, `FUNC.run`, the UI components | Definitions |
| `modules/` | State and services shared by the whole app, used as `MODS.security`, `MODS.users`, `MODS.live` ... | Modules with `exports.install` |
| `lib/` | The domain logic (IMAP, SMTP, threads, rules, search), plain functions loaded with `require()` so a test can use them without the web server | Libraries |
| `resources/*.resource` | Translations | `@(Text)` and `LOCALIZE()` |
| `database/` | NoSQL tables, the encryption key and the attachments (never committed) | `NOSQL()` |

## Conventions you will recognise

- **Actions.** Every endpoint is a `NEWACTION('Entity|operation', { ... })` with a `route` such as `+API /api/ +draft_save --> Drafts|save`. The `+` means signed in, `user: true` loads the session and `permissions: 'admin'` restricts it to administrators. The input is declared in the action (`input: '*email:Email, *password:String(128)'`), so the framework validates it before your code runs.
- **Answering.** An action answers with `$.callback(data)` or `$.invalid(message)`. Many operations are asynchronous, so they run inside `FUNC.run($, async () => ...)`: it calls `$.callback` with what you return, and turns a thrown error into `$.invalid`. A message that starts with `@(` is meant for the person and goes back as it is; anything else is logged with `Total.error()` and replaced by a generic message.
- **Authentication.** `AUTH()` in `definitions/auth.js` returns the user of the session or of an app's device token. Administrators carry the `admin` permission.
- **Request check.** The `request` middleware in `definitions/request.js` rejects a change that does not come from TotalMail's own page.
- **Texts.** Every text the person sees is `@(Text)`, in code and in views. `node bin/translations.js` lists what is missing in each language and a test fails when something is not translated.
- **Modules.** `MODS.<name>` is the way to reach another part of the app. A module is a file in `modules/` with `exports.install`; when its data must be loaded first it calls `PAUSESERVER()` so nothing is served before it is ready.
- **Data.** The state of each store is in memory and every change is written to the NoSQL tables of Total.js by `lib/mirror.js` (insert, modify or remove of the records that differ). Tables are opened with `NOSQL()` through `lib/tables.js`.
- **Framework helpers first.** Code uses `Total.Fs`, `Total.Path`, `Total.Crypto`, `PATH.root()`, `UID()`, `CONF`, `ON('service')` and `Total.error()`; ESLint rejects `require('fs')`, `require('path')`, `require('crypto')` and the other Node modules in application code.
- **Browser.** The pages do not touch the DOM by hand. Each window keeps its state in the model of a plugin and the views bind to it with `ui-bind`, `ui-component` and `data-exec`. The components come from the Total.js CDN (`COMPONENTATOR` in `definitions/ui.js`).

## Style

The code follows the [Total.js guidelines](https://github.com/totaljs-es/guidelines), and ESLint checks what a tool can check (`npm run lint`, `npm run format` to fix):

- Tabs, single quotes, semicolons.
- `var` or `let` inside functions; `const` only at the top of a file (requires and `REG_*` constants).
- No braces around a single statement; the statement goes on the next line.
- A blank line after the opening of a function with several statements, and between top-level blocks.
- Comments say why, above the code they explain.

## Adding an operation

1. Add a `NEWACTION('Things|do', { user: true, route: '+API /api/ +thing_do --> Things|do', input: '*name:String(80)', action: ($, model) => FUNC.run($, () => ...) })` in the `actions/` folder of the plugin it belongs to.
2. Call it from the plugin's `public/*.js` with the same route name.
3. Write every visible text as `@(Text)` and run `node bin/translations.js --add`.
4. Add a test in `tests/` (`npm test` runs them all) and run `npm run lint`.

## The vendored SMTP sender

`lib/vendor/total5-mail.js` is a copy of the SMTP sender of `total5@0.0.19` with corrections; the reason and the list are in [live-mail.md](live-mail.md#the-smtp-sender).
