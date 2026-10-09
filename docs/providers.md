# Account types and provider guides

New accounts start from an **Account type** picker. **Other or hosting** is the default and keeps the existing behaviour: type the address, choose *Discover servers* (HTTPS autoconfiguration, then DNS SRV), review, enter the password. Choosing a known provider fills its servers and sign-in name, collapses the server settings, hides discovery and shows a short guide with the steps that must be done outside TotalMail, with direct links. The picker is also shown when editing, so the type of an existing account can be changed: the type is recognised from the account (its OAuth provider or its servers), and choosing another one rewrites the servers and sign-in method of that same account. An account saved as OAuth before the sign-in existed is converted by signing in; the sign-in must be for the same email address.

| Type | Sign-in | Notes |
|---|---|---|
| Other or hosting | password | servers from discovery |
| Outlook / Microsoft 365 | OAuth 2.0 | **Sign in with Microsoft**; needs the application registered once per installation, see [oauth.md](oauth.md). Until then the type explains that it is not set up |
| Gmail | app password | needs 2-Step Verification; Workspace administrators can disable app passwords |
| iCloud Mail | app-specific password | needs two-factor authentication; if the IMAP sign-in fails try the name before the at sign |
| Seznam | password | external mail programs must be allowed in Seznam Email settings |
| Yahoo Mail | app password | generated in the account security page |

## Administering account types

Administrators see **Account types and sign-in** (sidebar and workspace settings). From there, for this installation only (the `instance_*` tables of `database/`, never the shared code):

- Show or hide the shipped account types (**Other or hosting** is always available) and choose the **default** type that new accounts start on, for example a company mail server.
- Add, edit and delete **account types of their own**: name, email domains (so the type is recognised from an address), IMAP and SMTP servers, password or app password, a short description, guide steps (one per line, `text | https://link`) and a note. Servers must be public host names, links must be https, and a type cannot replace a shipped one or use OAuth.
- Enter the sign-in application of an OAuth provider; see [oauth.md](oauth.md).

Existing accounts keep working when their type is hidden or deleted. Every action checks that the session owner is an administrator and the usual request headers.

## Recognising the provider

While typing an address under *Other*, TotalMail looks up only the **domain**: first the provider's own domains, then the MX records (`contoso.example` points to `mail.protection.outlook.com`, so Microsoft is suggested even for a custom domain). It offers *Use it*; it never switches by itself. No address or password leaves the server in this step, only a DNS query for the domain.

When verification fails because the server rejected the sign-in, the message says why when the provider is recognised: "requires OAuth" or "needs an app password", pointing at the account type list, instead of a generic connection error. Network and TLS errors keep their own messages.

## Adding a provider

A provider is a JSON file in `plugins/accounts/providers/` (any plugin may ship its own `providers/` folder). Copy one of the existing files and edit it; no code changes. Fields:

- `id` (lowercase letters, digits, dashes), `name`, `icon` (a Total Icons name such as `server`, `google`, `apple`, `microsoft`), `order`, `summary`, `note`.
- `auth`: `password`, `app-password` or `oauth2` (OAuth providers also need an entry in `lib/oauth.js` and, for guidance while unconfigured, a `setup` list of steps). `available: false` hides the sign-in of a provider that is not ready.
- `imap` and `smtp`: `host`, `port`, `security` (`tls` or `starttls`). `username: "email"` fills the sign-in name from the address.
- `domains` and `mx` (suffixes such as `.google.com`) for recognition.
- `steps`: a list of `{ "text", "url" }`; links must be `https`.
- `discover: true` for the discovery entry (no servers).

Text values use the usual `@(English text)` markers and need their entries in `resources/*.resource` (`npm test` checks every language). Files are validated when the server starts (valid public hostnames, ports, https links, bounded text); an invalid file is skipped and logged, it does not break the others.

Gmail and Google Workspace use an app password here on purpose: Google's OAuth for mail needs a verified application, and unverified ones expire their tokens after seven days.
