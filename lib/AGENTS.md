# AGENTS.md of lib/

The rules of the project are in [../AGENTS.md](../AGENTS.md). These are the ones of this area.

`lib/` is the domain logic: IMAP (`imap.js`, `live.js`), sending (`smtp.js`), reading mail (`html.js`, `threading.js`, `extract.js`, `ics.js`), accounts and providers (`providers.js`, `discovery.js`, `oauth.js`, `diagnose.js`), people and sessions (`identities.js`, `sessions.js`, `totp.js`, `devices.js`), rules (`rules.js`), and the storage (`store.js`, `mirror.js`, `tables.js`). They are plain functions that a test loads with `require()`, without the web server.

- **No Node.js built-in modules.** ESLint rejects `require('fs')`, `require('path')`, `require('crypto')`, `require('net')`, `require('tls')` and the rest in this folder: use `Total.Fs`, `Total.Path`, `Total.Crypto` and the helpers of the framework. The tests are free to use the built-in modules.
- **`lib/vendor/` is a copy and is not linted.** `total5-mail.js` is the SMTP sender of `total5@0.0.19` with corrections; `docs/live-mail.md` lists them. Change it only for a reason that goes in that page.
- **Storage:** the state of a store is in memory and every change goes to the NoSQL tables through `mirror.js`, on a copy that becomes current only when the database accepted all of it. Open tables with `tables.js`. `docs/storage.md` describes the tables.
- **Secrets:** the key that protects the mail passwords is in `database/`, and `identities.js` is the only place that uses it. Never log a password, a token or a decrypted credential.
- **Network:** a mail server must resolve to a public address, certificates are always verified and TLS 1.2 or newer is required. A change here is a change to the security of the application: test the cases that must be refused, not only the ones that work.
- **HTML from mail** is untrusted. `html.js` cleans it with `sanitize-html` before it reaches the frame, and the assistant is given the text as the reader sees it. Do not loosen what it allows without a test for what it must still remove.
- Texts that a person can see (an error that is shown) are written `@(Text)`.
