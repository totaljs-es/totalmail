# AGENTS.md of modules/

The rules of the project are in [../AGENTS.md](../AGENTS.md). These are the ones of this area.

`modules/` holds what no plugin owns and the whole application uses: the storage (`mirror.js`, `tables.js`), the settings of the installation (`instance.js`), the languages (`localization.js`, `appearance.js`) and `lazy.js`. Total.js loads every `.js` of this folder and registers it as `MODS.<file name>`; the loader calls `exports.install()` when the module has one. The logic that belongs to a feature is in the plugin that owns it (`plugins/mail/imap.js`, `plugins/rules/engine.js`...): see [../plugins/AGENTS.md](../plugins/AGENTS.md).

- **Reach another part through the registry, inside a function.** `MODS.instance` and `PLUGINS.users.security` may not exist yet when a file is read, and the order of the files is not a contract: read them inside the function that needs them, or in `ON('ready')`. Inside this folder, in the tests and in `bin/` a file is loaded with `require()`, so it can run without the web server.
- **Storage:** the state of a store is in memory and every change goes to the NoSQL tables through `mirror.js` (`Mirror.writer` is the one way to change a store), on a copy that becomes current only when the database accepted all of it. Open tables with `tables.js`. `docs/storage.md` describes the tables.
- **No Node.js built-in modules** (ESLint rejects them here): use `Total.Fs`, `Total.Path`, `Total.Crypto`. The tests are free to use them.
- Texts that a person can see (an error that is shown) are written `@(Text)`.
