# TotalMail

A self-hosted mail client for companies and teams, equally suited to personal use. Read and send from any IMAP/SMTP account (Gmail, Outlook and Microsoft 365, iCloud, Yahoo, Seznam, your own hosting) in one place, with a private mailbox for every user.

Built with [Total.js 5](https://www.totaljs.com) and jComponent 20. Its data lives in the embedded NoSQL database of Total.js, in one private folder, so it needs nothing but Node.js: no database server, no queue, no cloud service.

Your existing mail provider still receives and delivers mail. TotalMail connects to it through IMAP and SMTP; installing TotalMail does not replace the mail server or require changing your domain's MX records. The web client and native apps for Mac, iPhone and iPad connect to the same TotalMail instance.

## What it does

- **Several accounts, several people.** The first visitor creates the administrator; the administrator adds the rest. Each person has their own accounts, mail and drafts, and nobody can see another's.
- **Adding an account is guided.** Pick the provider or type the address and TotalMail looks up the servers from the domain only (no password is sent). Microsoft and Google accounts can sign in with OAuth; aliases let one account send from several addresses.
- **Fast, live reading.** New mail arrives through IMAP IDLE, older mail loads page by page, conversations are grouped, and you can search the server as well as what is already loaded.
- **Controlled sending.** Every message is reviewed and confirmed before it leaves. Reply quotes the original and Forward carries its attachments; Cc, Bcc, drag-and-drop or pasted attachments, per-account signatures, address suggestions and simple formatting (bold, italic, links, lists, quotes) are there; a copy goes to the Sent folder.
- **Efficient to work in.** Select several messages and act on all of them, keyboard shortcuts (press `?`), search with `from:`, `to:`, `subject:`, `is:unread`, `has:attachment`, `after:` and `before:`, and a list that stays quick with thousands of messages.
- **Rules, folders, notifications.** Move, archive or flag incoming mail by rule; create folders; get a system notification when new mail arrives.
- **Optional AI assistant, manual and limited.** Summarize, translate, write a message from a few words, draft a reply (also from your own documents), adjust the tone and check the spelling of a draft, with a model you choose (Claude, Ollama, llama.cpp, LM Studio, vLLM or a hosted service). Off by default. Each action is asked for by a person on one text; the model has no tools and no access to the rest of the mailbox, reads only what a reader can see, and what it returns is checked and only suggested ([docs/assistant.md](docs/assistant.md)).
- **Support when an account does not work.** One button checks the servers step by step (settings, name, port, TLS and certificate, sign-in, and the domain's MX, SPF and DMARC) and says what to change; it needs no AI ([docs/live-mail.md](docs/live-mail.md)).
- **Apps that stay signed in.** A native app signs in once (password and two-step code) and gets a device token of its own; you see every device in *My devices* and can sign any of them out ([docs/apps-api.md](docs/apps-api.md)).
- **Reader tools.** Download the original `.eml`, print, unsubscribe from mailing lists, and see calendar invitations.
- **Mail you can open safely.** HTML mail is cleaned and shown in a sandboxed frame; remote images stay blocked until you ask for them.
- **Accessible and multilingual.** English, Spanish, Slovak, German, French, Italian, Portuguese and Greek, each with its flag (add a language by dropping a `resources/<code>.resource` file), light and dark, installable as an app, keyboard operable, tested with axe-core and at 200 % zoom, with undo for archive and trash.

Mail passwords are stored encrypted with AES-256-GCM, sessions are kept as hashes, two-step verification (authenticator app and recovery codes) is available to everyone, and the app refuses requests that do not come from its own page. If you are ever locked out, `node bin/admin.js` gets you back in from the server.

## Install

TotalMail should be served over HTTPS (the session cookie is `Secure`, and Microsoft sign-in requires it), so run it behind a reverse proxy such as nginx, Caddy or Traefik. The proxy must send `X-Forwarded-Proto` and append the client address to `X-Forwarded-For`.

### Docker

```bash
git clone https://github.com/totaljs-es/totalmail
cd totalmail
docker compose up -d --build
```

It listens on `127.0.0.1:8000`; point your proxy there. People, mailboxes and the encryption key live in the `totalmail-data` volume: back it up. Open the address and create the administrator.

Sign-in with Microsoft or Google is set by the administrator inside the app and kept in the database (see [docs/oauth.md](docs/oauth.md)); there are no variables to define. Everything else is explained in [docs/installation.md](docs/installation.md).

### Node.js

Node.js 22 or newer:

```bash
npm ci --omit=dev
NODE_ENV=production node index.js 8000
```

A working `config` is included. Edit its non-secret settings when needed; `config.example` lists the same options as a reference. Mail credentials, OAuth secrets and assistant keys are configured in the app and encrypted in `database/`.

## Updating and backups

Update with `git pull` and `docker compose up -d --build` (or restart the process). Sessions survive a restart. Back up the whole `database/` folder together with the key inside it (`credentials.key`): without the key the stored mail passwords cannot be read.

## Status

TotalMail is in daily use on a hosted instance and its logic is covered by more than 200 automated tests that run real IMAP and SMTP conversations against local protocol fixtures. It has been verified in Chrome; Safari and a real screen reader are still to be checked. CI runs the lint, the tests on Node 22 and 24, and builds and starts the Docker image. Single process, embedded database: it is meant for one person, a family or a small company, not thousands of users. Bugs and ideas are welcome as issues.

## Documentation

- [docs/installation.md](docs/installation.md): installing, updating, proxy, backups.
- [docs/users-and-accounts.md](docs/users-and-accounts.md): people, mail accounts, two-step verification, getting back in.
- [docs/providers.md](docs/providers.md) and [docs/oauth.md](docs/oauth.md): account types, Microsoft and Google sign-in.
- [docs/live-mail.md](docs/live-mail.md): how it talks to your mail servers, and the limits.
- [docs/assistant.md](docs/assistant.md): the optional AI assistant and why it is limited.
- [docs/apps-api.md](docs/apps-api.md): how a native app signs in and talks to an instance.
- [docs/storage.md](docs/storage.md): where the data is.
- [docs/total-js.md](docs/total-js.md): the map of the code for Total.js developers.
- [docs/localization.md](docs/localization.md) and [docs/accessibility.md](docs/accessibility.md).
- [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and [CHANGELOG.md](CHANGELOG.md).

## Development

```bash
npm ci
npm run format    # style of the Total.js guidelines (ESLint --fix)
npm run lint
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for how the code is organised, how to add a language, and what the project deliberately does not do. Security problems: [SECURITY.md](SECURITY.md).

For AI coding agents, [AGENTS.md](AGENTS.md) has the instructions of the project (also as `CLAUDE.md`, `GEMINI.md` and `.github/copilot-instructions.md`), with the skills in `.claude/skills/`.

## License

[MIT](LICENSE)
