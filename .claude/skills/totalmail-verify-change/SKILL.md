---
name: totalmail-verify-change
description: Use when you finish a change to TotalMail (code, a plugin, a view, a translation, documentation) and have to check it before you say that it works.
---

# Verify a change

Say that something works only after you have **run** it. From the cheapest:

1. **The style:** `npm run format` applies the rules of the Total.js guidelines, and `npm run lint` must report nothing.
2. **The texts:** `node bin/translations.js` must list nothing missing in any language. If you added a visible text, run it with `--add` and translate.
3. **The area that you touched:** `node --test tests/<file>.test.js`. Mail protocol: `imap-protocol`, `smtp-protocol`, `search-protocol`, `paging-protocol`. Accounts and sign-in: `access-http`, `two-step-http`, `oauth`. Storage: `store`, `mirror`. The browser files: `plugins-boot`. They need the `openssl` command.
4. **Make the test able to fail.** Break the code on purpose (remove the check, return early), see the test fail, and put it back. A test that you never saw fail may test nothing.
5. **The whole suite:** `npm test`. Report the numbers as they are: how many passed, failed or were skipped, and why.
6. **A change to a window:** start the application (`node index.js 8000`), open it and use the window with the keyboard. The tests check the logic, not what a person sees. Say what you checked in the browser and what you did not.
7. **A change to security** (sessions, requests, mail servers, HTML mail, the assistant): test the cases that must be **refused**, not only the ones that work, and read the matching page of `docs/` and `SECURITY.md`.

If something fails only in the continuous integration, it runs the lint and the tests on Node.js 22 and 24 and builds the Docker image: reproduce with that Node.js version.
