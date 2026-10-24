# AGENTS.md of tests/

The rules of the project are in [../AGENTS.md](../AGENTS.md). These are the ones of this area.

`npm test` runs `node --test tests/*.test.js`: a file named like `rules.test.js` is a test, any other file (`db.js`, `fixtures/`) is a helper. The suite has no network and no real mailbox, and needs the `openssl` command.

- **Real conversations, local servers.** The protocol tests (`imap-protocol`, `smtp-protocol`, `search-protocol`, `trash-protocol`, `sent-copy-protocol`, `paging-protocol`, `diagnose`...) start a server of their own with TLS on a random port, with a certificate made by `openssl` in a temporary folder, and run the real `ImapFlow` or the SMTP sender against it. Copy the pattern of `imap-protocol.test.js` or `diagnose.test.js`.
- **Bootstrap the framework** with `require('total5')` at the top, so `NOSQL()`, `CONF` and the helpers exist as they do in the application.
- **Data** goes to a temporary folder, through `tests/db.js` (`store`, `reopen`, `rows`, `failing`...). Clean it up: leave nothing in the temporary directory.
- **`*-http.test.js`** copy the application into a temporary folder, start it on a free port and talk to it over HTTP (sessions, two-step verification, devices, the AI actions). A request that changes something needs the header `X-TotalMail: 1` that the application checks (`definitions/request.js`, `modules/security.js`).
- **`translations.test.js`** fails when a text written as `@(...)` is missing in a language file: run `node bin/translations.js --add`. `plugins-boot.test.js` has a list of the browser files of the plugins: a new one goes there.
- A change that fixes a bug comes with a test that fails without it. After you write a test, break the code on purpose and see it fail, then put the code back.
- Do not put a real address, a real password or a real mailbox in a test or a fixture. The text of mail in `tests/fixtures/` is data for the tests.
