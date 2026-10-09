# Storage

TotalMail keeps its data in the embedded **NoSQL** database of Total.js, in the same private folder as the encryption key: `database/` (readable by the account that runs TotalMail only). Nothing else has to be installed, and one folder is all there is to back up. It is read and written with `NOSQL()` and its QueryBuilder (`insert`, `modify`, `remove`, `find`), never with files of our own.

## Tables

| Table (file in `database/`) | Holds |
| --- | --- |
| `users_users` | The people: name, email, role, salted password hash, encrypted authenticator secret and recovery-code hashes |
| `sessions_sessions` | Signed-in sessions: SHA-256 of the token, person, expiry |
| `instance_providers`, `instance_values` | Account types the administrator added; the OAuth applications (secrets encrypted), hidden types, default type, the assistant settings and its daily counts |
| `knowledge_collections`, `knowledge_docs` | Collections and documents of the knowledge base |
| `mail_<user-id>_accounts`, `_messages`, `_drafts` | One person's mail accounts (credentials encrypted), cached messages and drafts |

## How it works

- **In memory for reading, in the database for keeping.** A store loads its tables when the server starts (nothing is served before that: `PAUSESERVER()`), answers every read from memory, and changes the database through `lib/mirror.js`.
- **Only what changed is written.** A change is made on a copy; `mirror.save()` compares it with what the database holds and sends an `insert` for each new record, a `modify` for each changed one and a `remove` for each one that went. Only when the database has accepted all of it does the copy become the current state: a failed write changes nothing.
- **Order.** The database does not keep the order of records, so each one carries a counter that is removed when it is read; a list comes back in the order it was created (drafts: the most recently saved first).
- **No trace of old values.** The database appends a change and marks the old line as removed. For the people, the sessions and the installation settings the files are cleaned after every change, so a replaced password hash or a spent recovery code is gone from the file. Mailboxes are cleaned every six hours, and a deleted person's tables are deleted with `clear()`.
- **Modules.** The services live in `/modules` (`MODS.security`, `MODS.users`, `MODS.instance`, `MODS.knowledge`); the logic that does not need the framework lives in `/lib` and is loaded with `require()`, which is why it can be tested on its own.

## Moving from the JSON files

Earlier versions kept `users.json`, `sessions.json`, `instance.json`, `knowledge.json` and `mail-<id>.json`. The first start of this version imports each one that exists into its tables and renames it to `<name>.migrated`. A file that cannot be read is ignored (and left where it is), and the import never runs when the tables already hold data.

## The server tool

`node bin/admin.js list | reset-password <email> | remove-two-step <email>` works on the same tables (`--database <folder>` for another folder). Stop TotalMail first.
