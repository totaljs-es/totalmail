# Changelog

## Unreleased

- Sent mail: quotes inside quotes (`> >`) become nested blockquotes, and web links and email addresses in the signature can be clicked.
- Received mail: styled links (buttons) keep their safe styles, and more everyday layout styles are allowed (plain-colour `background`, `font`, border width and style, corner radii, `table-layout`).
- Sent mail: the Message-ID uses the domain of the sending address instead of `totalmail.local`.
- Device sign-out remains effective when a concurrent activity write completes; revocations are persisted without restoring old tokens.
- Security: a mail server name must end in a name, so `0127.0.0.1`, `0x7f.0.0.1` and `127.1` are no longer accepted as server names. The system resolver reads these forms in its own way, which is the case of the Node.js security release of 2026-10-21 (`tls.checkServerIdentity()` with IPv4 literals, CVE-2026-106069 and related). The check of the resolved address stays as it was.

- German, French, Italian, Portuguese and Greek (formal register), and each language shown with its flag (circle-flags, MIT) in the selectors.
- The composer draws the marks of the formatting as what they make while you write (bold, italic, links, lists, quotes, the signature), in colour only so the cursor never drifts; the same grammar the server turns into HTML.
- Under the list of messages, the way to load older mail is a button, as in the native app.
- Language selectors are wide enough for the flag and the name.

- Settings is one window with a list of sections on the left (Preferences, Mail accounts, Rules, My profile, My devices and, for administrators, Company users, Account types and sign-in, AI assistant); on a phone the list becomes tabs. The forms have more room, and the colours of errors and checks keep their contrast in dark mode.
- Security: the address of a client comes from `X-Forwarded-For` only when the connection is from a proxy of ours (loopback, a private network, or what `trust_proxy_from` names in `config` for a proxy with a public address); the saved assistant key is sent only to the server it was saved with (a new server address asks for the key again); the lookup of a domain's mail configuration connects to the address that was checked and stops at 64 kB; password tries of a signed-in person count per person and no longer use up the places of the sign-in page of their address; the command-line recovery (`bin/admin.js`) also revokes the devices; an OAuth sign-in of a person disabled meanwhile adds nothing, and one person cannot use up the places of the others.
- A PDF whose hex string never closes no longer hangs the server when it is added to the knowledge base, compressed parts of documents may not expand past 32 MB, and the connection check ends when a server stalls STARTTLS or never ends a line.
- A draft whose delivery is unknown (after an SMTP failure or a restart while sending) can be discarded once you have looked in Sent, and no longer keeps its account from being removed. Nothing is ever sent again.
- Saving an account without `authType` keeps its type (an app using `account_save` no longer turns an OAuth account into a password one); Greek is accepted by the assistant's translation; a failed OAuth token renewal no longer blocks the account until a restart.
- Upgrading behind a proxy: the address of a client is read from `X-Forwarded-For` only when the connection comes from the same machine, a private or carrier-grade NAT network (Tailscale included) or link-local. A proxy with a public address must be named in `config` (`trust_proxy_from : 203.0.113.5, 2001:db8::/32`), or every client counts as the proxy for the sign-in limits.
- Upgrading from a version that has `lib/`: delete `lib/` and the old files of `modules/` (everything except `appearance.js`, `instance.js`, `lazy.js`, `localization.js`, `mirror.js` and `tables.js`). Total.js loads every file of `modules/`, so a leftover `modules/live.js` would take the place of the new code. `git pull` does it for you.
- Code: `mail.js` is split into `display.js`, `undo.js`, `notify.js`, `selection.js` and `composer.js`, with 38 tests that run the real file in Node; every action has a `name`; `lib/` is gone (Total.js has no such folder): the logic of each feature is a file of the plugin that owns it, exported by its `index.js` and read as `PLUGINS.mail.live`, `PLUGINS.users.security`, `PLUGINS.ai.assistant`...; `modules/` keeps the storage, the settings and the languages; the vendored SMTP sender is in `private/vendor/`; actions and routes read what they need through `MODS`/`PLUGINS`.

## 1.0.0

First public release.

- Several people, each with private mailboxes; several IMAP/SMTP accounts per person, with guided setup and Microsoft and Google sign-in (OAuth).
- Live reading (IMAP IDLE), paging, conversations, server search with operators, rules, folders, undo, notifications.
- Controlled sending with review, Cc/Bcc, aliases, signatures, attachments and simple formatting.
- Two-step verification, encrypted mail passwords, hashed sessions, sandboxed HTML mail.
- Optional manual AI assistant (summarize, translate, write from a few words, reply, tone, spelling), with a knowledge base of your own documents; no tools, no automatic runs.
- Step-by-step connection check for accounts that do not work.
- English, Spanish and Slovak (German and French were added afterwards); light and dark; accessible; Docker image and CI.
