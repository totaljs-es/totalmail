# AGENTS.md of plugins/

The rules of the project are in [../AGENTS.md](../AGENTS.md). These are the ones of this area.

Each folder is one part of the application, loaded by Total.js as a plugin: `mail`, `accounts`, `users`, `providers`, `rules`, `ai`, `devices`, `reception` and `access`. The page that joins them is `views/index.html`.

- `index.js` is the manifest: `exports.name = '@(Rules)'`, `exports.icon` (a Tabler icon class) and `exports.visible = (user) => ...`.
- `actions/*.js` is the API of the plugin: one `NEWACTION('Entity|operation', { ... })` for each operation, with `route`, `input`, `user` or `permissions`, and `action`. The `+` at the start of a route (`+API /api/ +rule_save --> Rules|save`) means a signed-in person. A person's data is always reached through their own store (`MODS.users.forUser($.user)`), never by an id that came from the request alone.
- `views/*.html` are the windows. They are composed in `views/index.html` with `@{view('#id/views/name', model)}`: a new window has to be added there.
- `public/*.js` is the browser side: `PLUGIN('id', function(exports) { ... })`. It calls the API with the same route name and keeps its state in the model; the view binds to it. Do not touch the DOM by hand.
  - `mail/public/mail.js` is the window itself; what has a clear edge of its own is a file next to it that the window gives what it needs: `display.js`, `quote.js`, `threads.js`, `query.js` and `format.js` are pure functions, and `undo.js`, `notify.js`, `selection.js` and `composer.js` are factories (`totalmailcomposer(deps)`) that keep their own state and return what the rest of the window may use. A new file goes in `views/index.html` before `mail.js`, in the `order` of `tests/mail-harness.js` and in `tests/plugins-boot.test.js`; `tests/mail-window.test.js` is the net under all of them.
- Every plugin has an `index.js`: Total.js does not load a folder without it. A plugin that is only a window (`folders`) has just the manifest and no `actions/`.

Things to remember:

- Every visible text is `@(Text)` with no parentheses inside, in the views and in the JavaScript of `public/`. `node bin/translations.js --add` adds the new ones to the eight language files.
- The windows are tested for accessibility (keyboard, roles, 200 % zoom): see `docs/accessibility.md` before you change how a window works.
- `tests/plugins-boot.test.js` loads the browser files of every plugin with fakes: a new `public/*.js` goes in its list.
- Keep the actions thin. The logic that does not need the framework is a file beside `index.js` (`plugins/mail/imap.js`), so a test can `require()` it without the web server. What the rest of the application needs is exported by `index.js` and read as `PLUGINS.<id>.<name>` (`PLUGINS.mail.live`, `PLUGINS.users.security`, `PLUGINS.ai.assistant`, `PLUGINS.rules.engine`...), inside a function or in `ON('ready')`, never when a file is read: the plugins load in no fixed order. A file that is a singleton of the application has an `install()`, which the `install()` of `index.js` calls.

What each plugin owns:

- `mail`: reading and sending (`imap.js`, `smtp.js`, `live.js`, `watch.js`, `changes.js`, `network.js`, `diagnose.js`), the private mailbox of each person (`store.js`, `mailboxes.js`), and what is done with mail (`html.js`, `threading.js`, `ics.js`, `files.js`, `aliases.js`, `welcome.js`, `credential.js`).
- `users`: people, sessions and devices, two-step codes and the throttles of the sign-in (`security.js`, `identities.js`, `sessions.js`, `devices.js`, `totp.js`, `pending.js`, `clientip.js`).
- `ai`: the assistant (`assistant.js`), the knowledge base (`knowledge.js`) and the text of documents (`extract.js`).
- `providers`: the account types (`catalogue.js`) and the OAuth sign-in (`oauth.js`). `accounts`: the servers of an address (`discovery.js`). `rules`: the rules (`engine.js`).

Rules for that logic:

- **No Node.js built-in modules.** ESLint rejects `require('fs')`, `require('path')`, `require('crypto')`, `require('net')`, `require('tls')` and the rest in these files: use `Total.Fs`, `Total.Path`, `Total.Crypto` and the helpers of the framework. The tests are free to use the built-in modules.
- **`private/vendor/` is a copy and is not linted.** `total5-mail.js` is the SMTP sender of `total5@0.0.19` with corrections; `docs/live-mail.md` lists them. Change it only for a reason that goes in that page.
- **Secrets:** the key that protects the mail passwords is in `database/`, and `identities.js` is the only place that uses it. Never log a password, a token or a decrypted credential.
- **Network:** a mail server must resolve to a public address, certificates are always verified and TLS 1.2 or newer is required. A change here is a change to the security of the application: test the cases that must be refused, not only the ones that work.
- **HTML from mail** is untrusted. `html.js` cleans it with `sanitize-html` before it reaches the frame, and the assistant is given the text as the reader sees it. Do not loosen what it allows without a test for what it must still remove.
