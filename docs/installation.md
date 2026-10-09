# Installing TotalMail

TotalMail is one Node.js process (Node.js 22 or newer) built on Total.js 5. Its data lives in a private `database/` folder next to the application, so it needs no database server. Run a single process.

## First administrator

1. Install and start it (below) behind HTTPS.
2. Open the address and enter your name, email and a password of at least 12 characters. There is no installation key and no default password.
3. Once the administrator exists, this screen closes. Only administrators add people; each person manages their own mail accounts.

On a new public address the first visitor can create the administrator, so finish this step before sharing the address.

## Docker

```bash
git clone https://github.com/totaljs-es/totalmail
cd totalmail
docker compose up -d --build
```

The image is `node:24-alpine`, runs as the unprivileged `node` user in production mode and contains no people, keys or secrets. `database/` is the `totalmail-data` volume: back it up (see below). Sign-in with Microsoft or Google is entered by the administrator in the app and stored in that same database, so there is nothing else to configure. A working `config` is included in the image. If you need installation-specific settings (the public address, `trust_proxy`), edit the included `config` and uncomment its mount in `docker-compose.yaml`. It contains only public defaults; credentials belong to the encrypted database. The container listens on `127.0.0.1:8000`; the compose file explains how to join an nginx-proxy network instead.

## Node.js

```bash
npm ci --omit=dev
NODE_ENV=production node index.js 8000
```

A working `config` is included; `config.example` is a reference for its non-secret settings. Without a fixed `$port`, Total.js uses `PORT`, a numeric command-line argument, or port 8000. Set `$port` to a number only when it should override both. `$ip : 0.0.0.0` accepts connections on the host; use `127.0.0.1` when only a local proxy should connect.

## Production mode

By default Total.js starts in *debug* mode: it restarts when a file changes and prints more. Choose release mode with `NODE_ENV=production`, with `node index.js 8000 --release`, or with `production : true` in the `config` file (for hosts that generate their own start command). In release mode, uploading files no longer restarts the process, so restart it after an update.

## Behind a reverse proxy

Serve TotalMail over HTTPS from a proxy such as nginx, Caddy or Traefik. The proxy must send `X-Forwarded-Proto` and append the client address to `X-Forwarded-For`; the sign-in rate limit uses the last address, the one your proxy added. Without a proxy, add `trust_proxy : false` to `config`. The proxy's read timeout must be longer than 25 seconds (the new-mail long poll); the default of nginx is 60.

## Updates

1. Stop TotalMail.
2. Replace the application files **and delete the ones that no longer exist** in the new version. Total.js loads every file in `modules/`, `plugins/`, `controllers/` and `definitions/`, so a file left over from an older version can take the place of a newer module with the same name and break the application. With git, `git pull` does this for you; when uploading a folder, remove the old folders first.
3. Keep `database/` and `config` as they are, and start again. Sessions survive a restart.

Data written by older versions (`users.json`, `mail-<id>.json`, `instance.json`, `knowledge.json`, `sessions.json`) is imported into the database the first time a newer version starts; each file is renamed to `<name>.migrated` and not deleted. Remove them yourself when you have checked that everything is there.

## Backups

Copy the whole `database/` folder, including `credentials.key`: without the key the stored mail passwords cannot be read. Keep the copy somewhere private and outside the application folder. The folder is created readable by the account that runs TotalMail only. [storage.md](storage.md) lists what is inside.

If you are locked out, `node bin/admin.js` works from the server: `list`, `reset-password <email>` and `remove-two-step <email>` (stop TotalMail first).

## As an app

Chrome, Edge and Safari (Add to Dock, Add to Home Screen) can install TotalMail as a window of its own. There is no offline mode: a mail client has nothing to show without its server. Notifications work while TotalMail is open in a window or tab; there is no push service, so nothing arrives when every window is closed.

## Languages

English, Spanish, Slovak, German, French, Italian, Portuguese (Portugal) and Greek are included (German, French, Italian, Portuguese and Greek in the formal register; each language shows its flag in the selectors). See [localization.md](localization.md) to add another.
