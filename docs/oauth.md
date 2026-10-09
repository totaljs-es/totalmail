# OAuth sign-in (Microsoft and Google)

Microsoft no longer accepts passwords for IMAP and SMTP on Outlook.com, Hotmail and Microsoft 365. TotalMail signs in with OAuth 2.0 (authorization code with PKCE) and then uses the standard protocols with an access token (XOAUTH2). It needs an application registered once per TotalMail installation; the application ID is public, the client secret is not.

## What TotalMail stores

Only the refresh token, encrypted with the same key as mail passwords (`database/credentials.key`). Access tokens live in memory for about an hour and are renewed on demand; if Microsoft rejects the renewal (password changed, access revoked) the account is marked as needing a new sign-in and the account settings show **Sign in again**. Tokens and secrets are never sent to the browser. Revoke access at any time from the Microsoft account's app permissions page.

## Register the application (administrator, once)

In [Microsoft Entra](https://entra.microsoft.com) → App registrations → New registration:

1. **Supported account types:** *Accounts in any organizational directory and personal Microsoft accounts*.
2. **Redirect URI**, platform *Web*: `https://<your host>/oauth/microsoft/callback`. For local development also register `http://localhost:8000/oauth/microsoft/callback`. The address must match exactly, without a trailing slash.
3. **Certificates & secrets** → New client secret. Copy the secret **value** at once; it is shown only once.
4. **API permissions** → Add a permission → delegated:
   - Microsoft Graph: `offline_access`, `openid`, `email`, `profile`.
   - Office 365 Exchange Online (under *APIs my organization uses*): `IMAP.AccessAsUser.All` and `SMTP.Send`.
5. Copy the **Application (client) ID**.

## Configure the server

**In the administrator's window.** An administrator opens **Account types and sign-in** in the sidebar and enters the application ID, the client secret and the allowed accounts (the table below). The return address to register is shown there with a copy button. The secret is stored encrypted in the `instance_*` tables of this installation's `database/`, is never shown again and can be removed from the same window.

The application ID is public; the **secret is not**, which is why it is kept encrypted with the installation key, read by the server only, sent only to the provider's token endpoint and never included in a page, an API response or a log. There is nothing to put in `config` or in environment variables, and the settings travel with the database when you back it up.

**The allowed accounts must match the *Supported account types* of the registration**, or Microsoft refuses the sign-in (for example `AADSTS9002346: ... configured for use by Microsoft Account users only. Please use the /consumers endpoint`):

| Supported account types in Entra | Allowed accounts (window) |
|---|---|
| Any organization and personal accounts | `common` (the default) |
| Any organization (work or school) | `organizations` |
| Personal Microsoft accounts only | `consumers` |
| This organization only (single tenant) | the tenant (directory) ID |

The only setting that lives in `config` is `oauth_base_url : https://mail.example.com`, which fixes the address used for the redirect when TotalMail sits behind a proxy that does not forward the host (restart after changing it). Until the application ID is present, the Microsoft account type explains that sign-in is not set up and shows these steps.

Without a client secret TotalMail attempts the public-client flow (PKCE only). Microsoft accepts that only when *Allow public client flows* is enabled in the registration's Authentication page; a client secret is the dependable choice.

Personal mailboxes (Outlook.com, Hotmail, Live, MSN) read mail through `outlook.office365.com` like everyone else but send through `smtp-mail.outlook.com`; TotalMail picks the right outgoing server from the address.

## For people signing in

Choose **Outlook / Microsoft 365**, enter the email address and press **Sign in with Microsoft**. After approving, TotalMail returns with the account saved; use **Verify IMAP and SMTP** and then sync. Work and school accounts may need the organization's administrator to approve the application, or to allow users to consent. If Microsoft shows an administrator-approval screen, send them the application ID.

## "redirect_uri is not valid" (AADSTS50011 / invalid_request)

Microsoft compares the return address character by character with the ones registered under **Authentication → Web → Redirect URIs**. With Outlook / Microsoft 365 selected, the account window shows the exact address this server sends (*Return address*, with a copy button); register exactly that value. Typical causes: a trailing slash, `http` instead of `https`, another host name (for example behind a proxy; fix it with `oauth_base_url` in `config`), the address added under *Single-page application* or *Mobile and desktop* instead of *Web*, or the registration being edited in a different application than the one whose ID is configured.

## "Need admin approval"

Many organizations do not let users consent to applications that belong to another tenant and whose publisher is not verified, which is exactly what a self-registered multi-tenant TotalMail is for them. Microsoft then shows *Need admin approval* after the email address is entered. Nothing is wrong with TotalMail; an administrator of that organization has to approve the application once, and from then on every user of the organization can sign in. Ways to get there:

- **Send the administrator the approval link.** In the account window, with Outlook / Microsoft 365 selected and the email address entered, **Administrator approval link** produces it (`https://login.microsoftonline.com/<organization domain>/adminconsent?client_id=...`). The administrator signs in, reviews the permissions and accepts; Microsoft returns to TotalMail, which confirms the approval. The link grants the permissions listed in the application's registration, so they must be added there (see above).
- **Organization-owned registration (recommended for companies).** The organization's administrator registers the application in **their own tenant** as *Accounts in this organizational directory only*, adds the permissions, presses *Grant admin consent* on the registration's API permissions page and enters their tenant ID as the allowed accounts in that TotalMail. No other tenant is involved, so no external approval is needed.
- **Verified publisher.** Verifying the publisher through the Microsoft Cloud Partner Program removes the restriction for everyone, but it is a company process and is not required for either option above.
- Personal Microsoft accounts (Outlook.com, Hotmail) never need administrator approval, which makes them a quick way to check an installation while an organization decides.

## Organization settings that can still block it

- IMAP must be enabled for the mailbox (`Set-CASMailbox -Identity <user> -ImapEnabled $true`).
- Sending uses SMTP AUTH, which is disabled by default in many tenants. If reading works but verification fails on sending, the administrator enables it for the mailbox: `Set-CASMailbox -Identity <user> -SmtpClientAuthenticationDisabled $false`.

## Security notes

- The state value ties each sign-in to the user who started it, is single use and expires after ten minutes. The identity token is checked for audience and nonce.
- The return request from Microsoft does not carry the session cookie (it is `SameSite=Strict`), so the callback relies on that state and then returns to the app through a same-site page.
- The redirect address is built from the request host unless `oauth_base_url` is set; Microsoft rejects any address that is not registered, so a forged host cannot receive a code.

## Google (Gmail and Google Workspace)

Gmail keeps working with an app password; **Google (sign in)** is a second account type that signs in with Google instead, so no password is stored at all. It appears next to Gmail in the account types and is usable once the administrator has registered an application:

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials) create an **OAuth client ID** of type **Web application**.
2. Under **Authorized redirect URIs** add the return address shown in the administrator window (Settings → Account types and sign-in → Sign in with Google), e.g. `https://mail.example.com/oauth/google/callback`.
3. On the **OAuth consent screen** add the scope `https://mail.google.com/` (the only scope Google offers for IMAP and SMTP). For a Google Workspace organization choose **Internal**: no review is needed and everyone in the domain can sign in. For personal Gmail accounts the app stays in **Testing** with each person added as a test user (refresh tokens of a Testing app expire after seven days), or you go through Google's verification, which this scope requires.
4. Paste the **Client ID** and the **Client secret** in the administrator window.

How it differs from Microsoft: Google asks for `access_type=offline` and `prompt=consent` so a refresh token always comes back, takes no scope on the code exchange or the renewal, and the address must come back as `email_verified`. There are no tenants and no administrator-approval link. The same security rules apply: PKCE, a one-time state bound to the signed-in person, only the refresh token stored (encrypted), access tokens in memory.

