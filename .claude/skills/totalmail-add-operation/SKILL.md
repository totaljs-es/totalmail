---
name: totalmail-add-operation
description: Use when asked to add or change an operation of the TotalMail API (an action of a plugin), or the window and the browser code that call it.
---

# Add an operation

Read `AGENTS.md`, `plugins/AGENTS.md` and, if the logic goes to `lib/`, `lib/AGENTS.md`. `docs/total-js.md` is the map of the code.

1. **Find the plugin** the operation belongs to in `plugins/` (`mail`, `accounts`, `users`, `providers`, `rules`, `ai`, `devices`, `reception`, `access`) and look at an action next to it: `plugins/rules/actions/rules.js` is a short one.
2. **Put the logic where a test can reach it.** What does not need the framework goes to a function of `lib/`; the action only resolves the person's own store (`MODS.users.forUser($.user)`) and calls it. Never trust an account or message id that came from the request: resolve it from the signed-in person's store.
3. **Write the action:** `NEWACTION('Things|do', { user: true, route: '+API /api/ +thing_do --> Things|do', input: '*name:String(80)', action: ($, model) => FUNC.run($, () => ...) })`. Declare every field of the input. Use `permissions: 'admin'` for what only administrators may do. Throw `Error('@(Message for the person.)')` for a mistake of the person; anything else is logged and hidden.
4. **Call it from the browser** in `public/*.js` of the plugin with the same route name, and show it in a window of `views/`, bound to the model. A new window is also added to `views/index.html`.
5. **Texts:** every text the person sees is `@(Text)` with no parentheses inside. Run `node bin/translations.js --add`.
6. **Test it:** a test of the `lib/` function, and when the action has rules of access, an HTTP test (`tests/access-http.test.js` is the pattern). If you added a browser file, add it to `tests/plugins-boot.test.js`.
7. **Decide what it must not do.** It never sends mail without review, never lets a model act on mail, and never loads anything from an outside service (`AGENTS.md`).
8. Verify it with the skill `totalmail-verify-change`.
