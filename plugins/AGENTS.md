# AGENTS.md of plugins/

The rules of the project are in [../AGENTS.md](../AGENTS.md). These are the ones of this area.

Each folder is one part of the application, loaded by Total.js as a plugin: `mail`, `accounts`, `users`, `providers`, `rules`, `ai`, `devices`, `reception` and `access`. The page that joins them is `views/index.html`.

- `index.js` is the manifest: `exports.name = '@(Rules)'`, `exports.icon` (a Tabler icon class) and `exports.visible = (user) => ...`.
- `actions/*.js` is the API of the plugin: one `NEWACTION('Entity|operation', { ... })` for each operation, with `route`, `input`, `user` or `permissions`, and `action`. The `+` at the start of a route (`+API /api/ +rule_save --> Rules|save`) means a signed-in person. A person's data is always reached through their own store (`MODS.users.forUser($.user)`), never by an id that came from the request alone.
- `views/*.html` are the windows. They are composed in `views/index.html` with `@{view('#id/views/name', model)}`: a new window has to be added there.
- `public/*.js` is the browser side: `PLUGIN('id', function(exports) { ... })`. It calls the API with the same route name and keeps its state in the model; the view binds to it. Do not touch the DOM by hand.
  - `mail/public/mail.js` is the window itself; what has a clear edge of its own is a file next to it that the window gives what it needs: `display.js`, `quote.js`, `threads.js`, `query.js` and `format.js` are pure functions, and `undo.js`, `notify.js`, `selection.js` and `composer.js` are factories (`totalmailcomposer(deps)`) that keep their own state and return what the rest of the window may use. A new file goes in `views/index.html` before `mail.js`, in the `order` of `tests/mail-harness.js` and in `tests/plugins-boot.test.js`; `tests/mail-window.test.js` is the net under all of them.
- A plugin that is only a window (`folders`) may have no `index.js` and no `actions/`.

Things to remember:

- Every visible text is `@(Text)` with no parentheses inside, in the views and in the JavaScript of `public/`. `node bin/translations.js --add` adds the new ones to the eight language files.
- The windows are tested for accessibility (keyboard, roles, 200 % zoom): see `docs/accessibility.md` before you change how a window works.
- `tests/plugins-boot.test.js` loads the browser files of every plugin with fakes: a new `public/*.js` goes in its list.
- Keep the actions thin. The logic that does not need the framework belongs in `modules/`, where a test can reach it.
