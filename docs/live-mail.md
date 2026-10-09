# Talking to your mail servers

How TotalMail reads and sends, and the limits you should know about. Setup of each account type is in [providers.md](providers.md) and [oauth.md](oauth.md).

## Connecting

- **Verify first.** Saving an account contacts nothing. **Verify IMAP and SMTP** logs in to both servers without sending mail; **Sync inbox** then reads the latest 50 messages of each folder.
- **Safe connections.** The mail host must resolve to public addresses, certificates must be valid, TLS 1.2 or newer is required, and STARTTLS is required when you choose it. A mail server on a private network is not reachable.
- **App passwords.** Gmail, iCloud, Yahoo and others need an app-specific password (or OAuth); the guide for each provider says how to get one.
- **Passwords** are typed in the app only, stored encrypted (AES-256-GCM) and decrypted in memory just for each connection.

## Reading

- Messages are cached locally; **Load older messages** pages further back, up to 5,000 cached per folder. Search covers what is loaded and, on request, the server.
- A message body is downloaded when you open it (up to 25 MB). HTML mail is cleaned and shown in a sandboxed frame; remote images and tracking pixels stay blocked until you ask for them. Attachments are downloaded on demand and always served as downloads, never opened by the browser.
- Opening a message marks it read on the server (only the `\Seen` flag is added); read, unread and starred are confirmed by the server before the list changes. A failed change leaves the message as it was.
- New mail arrives through IMAP IDLE (one read-only connection per watched INBOX while a signed-in window is visible) with a one-minute timer as a safety net. Limits: 5 watched accounts per person, 20 in total. Behind a reverse proxy, the read timeout must be longer than 25 seconds (nginx's default of 60 is fine).
- Unread badges count the cached INBOX window, not the whole mailbox.

## Organising

- Archive, restore, move and trash use the server's native `MOVE` and check that the message really left its folder; there is no copy-and-delete fallback. If the connection drops during a move, synchronise before trying again.
- **Delete permanently** and **Empty the trash** work only in the account's own Trash, ask twice, and delete exactly the chosen messages (the server must support `UIDPLUS`).
- Folders and subfolders can be created from the folder icon; rules can move, archive or flag incoming mail.

## Sending

- Every message is reviewed and confirmed before it leaves; an edit made in another window invalidates the review. Up to ten addresses across To, Cc and Bcc, up to 10 attachments and 15 MB per message.
- Reply keeps the conversation (In-Reply-To and References); Reply all removes your own address and duplicates.
- A copy is saved in the server's Sent folder. If the server rejects or drops the connection, the draft stays locked as *submitted* so it is never sent twice by accident: check the provider's Sent folder before writing it again. A server accepting a message does not guarantee it reaches the recipient's inbox.

## The SMTP sender

`lib/vendor/total5-mail.js` is the MIT-licensed SMTP sender of `total5@0.0.19` with corrections: no second TLS handshake on implicit TLS, certificate and hostname validation with TLS 1.2+, TLS errors reported to the caller, TotalMail's own Message-ID and the exact message bytes kept for the Sent copy, complete 76-character base64 attachment lines with RFC 2231 file names, fragmented replies assembled correctly, LOGIN or PLAIN as the server advertises (and authentication confirmed), and success reported only after the server accepts the message. Keep these changes, and the protocol tests that cover them, when upgrading Total.js.

## When an account does not work

In the account window, **Check the connection step by step** walks through what a technician would check and says in plain words what to change. It changes nothing.

For the incoming (IMAP) and the outgoing (SMTP) server, in order:

1. **The settings fit together.** Port 465 and 993 expect TLS from the start; 587 and 143 expect STARTTLS; port 25 is for mail between servers and most networks block it.
2. **The name exists** and points to a public address.
3. **The server answers**, and a closed port, a firewall and a wrong connection mode are told apart.
4. **The encryption is modern and the certificate is good**: TLS 1.2 or newer, signed by an authority this server trusts, issued for that name, not expired (a warning in the last 14 days).
5. **The sign-in is accepted**, and a wrong password, an app password that is needed, a temporary refusal and, for Microsoft, SMTP AUTH turned off are told apart.

Then, for the domain of the address: whether it has an MX record, an SPF record and a DMARC record. Those do not stop the account from connecting, but they decide whether what you send arrives, so a missing one is a warning, never a failure.

Your password is only tried on a connection whose certificate was verified, and only on the server you configured: if the certificate is wrong, the sign-in is skipped and the report says why. Nothing is sent to anyone else, and no AI is involved.

## Not available

Push notifications when the app is closed, server-side search of message bodies across all folders, cross-account moves, and mail servers on private networks.
