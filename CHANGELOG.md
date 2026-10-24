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

## 1.0.0

First public release.

- Several people, each with private mailboxes; several IMAP/SMTP accounts per person, with guided setup and Microsoft and Google sign-in (OAuth).
- Live reading (IMAP IDLE), paging, conversations, server search with operators, rules, folders, undo, notifications.
- Controlled sending with review, Cc/Bcc, aliases, signatures, attachments and simple formatting.
- Two-step verification, encrypted mail passwords, hashed sessions, sandboxed HTML mail.
- Optional manual AI assistant (summarize, translate, write from a few words, reply, tone, spelling), with a knowledge base of your own documents; no tools, no automatic runs.
- Step-by-step connection check for accounts that do not work.
- English, Spanish and Slovak (German and French were added afterwards); light and dark; accessible; Docker image and CI.
