# Apps: signing in and talking to an instance

A native app is a client of the same JSON API as the web page. The instance stores the mail passwords encrypted and talks to the IMAP and SMTP servers. An app may accept a mail password when adding or updating an account and submit it to the instance, but must not persist it locally. It uses a device token for its own sign-in.

## Is this a TotalMail, and a new enough one

`GET /health/` answers `{ "status": "ok", "mode": "multiuser", "version": "1.0.0", "api": 1 }`. `api` grows when something changes that an app has to know about: compare it with the one the app was made for.

## Signing in

Every call is `POST /api/?lang=<code>` with a JSON body `{ "schema": "<name>", "data": { ... } }` and the header `X-TotalMail: 1` (the instance refuses requests without it). Answers are JSON; an error is an array of `{ error }` objects with the person's language.

1. `user_login` `{ email, password }`. The answer is `{ success: true }` (a session cookie is set) or, with two-step verification, `{ totp: true, token }`.
2. With `totp`: `user_totp` `{ token, code }` (a code of the authenticator app or a recovery code). The cookie is set.
3. `device_create` `{ name, platform, app, password }` with that cookie. The password is asked again on purpose. The answer is `{ token: "tmd_...", device }`: **the token is shown once**; keep it in the Keychain and drop the cookie.

From then on every call carries `Authorization: Bearer tmd_...` and the `X-TotalMail: 1` header. A wrong, ended or idle token is answered with `401`: ask the person to sign in again.

## Devices

`device_list` (the answer marks the caller with `current: true`), `device_revoke` `{ id }` (also how an app signs itself out). A device that is not used for 180 days ends; a change of password ends all of them. An app cannot add devices with a token, only with a session.

## What the app uses

`bootstrap` (accounts, folders, messages, drafts, settings), `message_read`, `message_seen`, `message_change`, `message_move`, `message_erase`, `message_text` (the text a reader sees, for a model on the device), `account_sync`, `account_search`, `account_older`, `draft_save`, `draft_send` (with the review step), `draft_delete`, `account_save`/`account_discover`/`account_delete` (a person's own accounts; removing one takes out its cached mail and drafts, never the mailbox on the mail server), `folder_create`, `rule_*`, `/html/{id}/` (cleaned HTML of a message), `/attachment/{id}/{index}/`, `/source/{id}/`, `/upload/{draft}/` and `/changes/?since=` (long poll for new mail). The schemas are the `route` lines of `plugins/*/actions/*.js`.
