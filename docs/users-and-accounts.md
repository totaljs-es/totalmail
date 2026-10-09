# People and mail accounts

## Signing in

The first visitor creates the administrator ([installation.md](installation.md)); after that there is no public registration. Administrators add the rest in **Company users**. Everyone has a private workspace: administrator status lets you manage people, not read their mail.

Sessions last eight hours and survive a restart of the server. Passwords are stored as salted scrypt hashes; sign-in attempts are limited per mailbox and per address; the application only accepts requests that come from its own page.

## Adding a mail account

1. Choose the account type (Gmail, Microsoft, iCloud, Yahoo, Seznam, or *Other*). Known providers fill in their servers and show a guide ([providers.md](providers.md)).
2. Enter a name and the email address. **Discover** looks up the servers from the domain only: your address and password are never sent to a discovery service. It tries the provider's own `autoconfig` files and Thunderbird's database over HTTPS, then DNS SRV records; a guess such as `imap.<domain>` is marked for you to review. You can always enter the settings by hand.
3. Review host, port, security and username, and save. Saving contacts nothing.
4. **Verify IMAP and SMTP**, then **Sync inbox**.

Mail passwords are optional while saving and are stored encrypted with the key in `database/credentials.key`; they never appear in any answer to the browser. Leaving the field empty when editing keeps the stored one. Accounts that use OAuth store no password ([oauth.md](oauth.md)). How the connections behave, and their limits, are in [live-mail.md](live-mail.md).

After the first successful sync of an account, TotalMail adds one private welcome message to its inbox. It is only local: it is never sent or uploaded.

## My profile

Everyone can open **My profile** to change the display name, login email, colour and default language. Changing the email or the password asks for the current password (12 to 128 characters) and signs out every other session. The login email is independent of your mail accounts.

## Managing people (administrators)

In **Company users**, **Manage** beside a person lets you:

- **Set a new password.** Their open sessions are closed.
- **Change the role** between member and administrator.
- **Disable or enable** the person. A disabled person cannot sign in and any open session stops at once; their data stays.
- **Delete** the person. The button asks twice. Their mailbox data and outgoing attachments are removed from this server; mail on the providers is not touched.
- **Remove two-step verification** if they lost their phone and codes.

Each of these asks for the administrator's **own password**. You cannot change your own role or disable or delete yourself, and the last active administrator can never be demoted, disabled or removed.

## My devices

*Settings → My devices* lists the apps where you are signed in to this TotalMail: its name, the system, the app, when it was last used and from which address. If you do not recognize one, or you lost a device, **Sign out** ends it at once. A device that is not used for 180 days signs itself out, and all of them sign out when you change your password or an administrator resets it. A web browser is not listed: it signs in with a session that lasts a few hours.

## Two-step verification

Everyone can turn on a second step (**My profile → Two-step verification**): a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Aegis, Step Two…). Turning it on asks for your password, shows a QR code (drawn in your browser; nothing goes to a web service) and the same key as text, and needs one correct code to finish. It then shows **eight recovery codes, once**: keep them somewhere safe.

- A code works once. A recovery code works once and is then gone. Five wrong tries spend the sign-in.
- Turning it off or making new recovery codes asks for your password and a code.
- The secret is encrypted with the installation key; recovery codes are stored only as hashes.
- Lost phone and codes: an administrator removes it for you in **Company users → Manage**. If the only administrator is locked out, use the server tool below.

## Getting back in from the server

`bin/admin.js` works on the data folder directly, so anyone who can run it can already read `database/`:

```bash
node bin/admin.js list
node bin/admin.js reset-password ana@example.com      # asks for the new password
node bin/admin.js remove-two-step ana@example.com
```

Stop TotalMail first and start it again afterwards: the running process keeps its own copy of the people in memory. Both commands end every open session. With Docker: `docker compose stop`, then `docker compose run --rm -it totalmail node bin/admin.js reset-password ana@example.com`, then `docker compose start`. `TOTALMAIL_NEW_PASSWORD` can supply the password instead of the prompt.
