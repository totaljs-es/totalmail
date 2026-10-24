---
name: totalmail-add-language
description: Use when asked to add a language to TotalMail, to translate missing texts, or after adding a text that a person sees (anything written as @(Text)).
---

# Add a language or translate texts

Read `docs/localization.md` first. Every text a person sees is written `@(Text)` in code and views, with no parentheses inside. The key of a text comes from the text itself, so nothing is numbered.

**A new language:**

1. Create `resources/<code>.resource` (the code of the language: `nl`, `pl`...) with the keys of `resources/en.resource`; each line is `key : translation`. Add `language_name : Nederlands` for the name shown in the selector, or the code is resolved with `Intl.DisplayNames`.
2. Add its flag as `public/flags/<code>.svg` (the other languages have theirs there) so the selectors show it.
3. Restart the server. A text without a translation shows in English, so a language can be added in stages; `node bin/translations.js` lists what is missing and, before you finish, it must list nothing.

**New texts:** `node bin/translations.js --add` adds every missing text to every language file with the English text, ready to translate. Translate them in each file; do not leave English where a translation is possible. A text with parentheses inside is cut by the framework: reword it. In browser code a text is written `TRANSLATE('@(Text)')`.

Run `node --test tests/translations.test.js` and `tests/localization.test.js`: they fail when a language lacks a text. Then use the skill `totalmail-verify-change`.
