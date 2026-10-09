# Security

TotalMail handles mail and mail passwords, so security reports are welcome and taken seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private reporting instead: on the repository, **Security → Report a vulnerability**. Include what you found, how to reproduce it and what an attacker gains. You will get an answer as soon as a maintainer can read it, and credit in the fix if you want it.

## What is in scope

Anything that lets someone read another person's mail, sign in without the password or two-step code, send mail as someone else, run code on the server, or reach internal addresses through the server (for example through the account setup or the connection check).

## How it is built to resist

- Mail passwords are stored encrypted with AES-256-GCM; people's passwords (scrypt), sessions and recovery codes are kept as hashes.
- Requests that change something must come from the app's own page (custom header and origin check); the session cookie is `HttpOnly`, `SameSite=Strict` and `Secure` over HTTPS.
- Mail servers must resolve to public addresses, certificates are always verified, and TLS 1.2 or newer is required.
- HTML mail is cleaned and shown in a sandboxed frame; remote images stay blocked until asked for.
- The optional AI assistant gets one text on request, without tools, reads only what a reader can see, and what it returns is checked before it is shown (`docs/assistant.md`).

## Supported versions

Only the latest release receives fixes.
