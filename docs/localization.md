# Languages

English, Spanish, Slovak, German, French, Italian, Portuguese (Portugal) and Greek are included (German, French, Italian, Portuguese and Greek in the formal register; each language shows its flag in the selectors). A first visit opens in English; the language chosen in the selector is remembered for a year. `?lang=es` (or any supported code) overrides it for one visit. Text that people write or receive (subjects, senders, bodies, drafts) is never translated.

## Adding a language

1. Create `resources/<code>.resource` (for example `de.resource`) with the keys of `en.resource` and your translations: each line is `key : translation`.
2. Optionally add `language_name : Deutsch` to the file for the name shown in the selector; otherwise the code is resolved with `Intl.DisplayNames`.
3. Restart. Phrases without a translation show in English, so a language can be added in stages.

`npm test` checks that every phrase used by the application is in every resource file (`node bin/translations.js` shows which are missing).

## Changing or adding a phrase (for developers)

Write the source in English with `@(...)` in views and `TRANSLATE('@(...)')` in browser code:

```html
<button>@(Save draft)</button>
```

```js
button.textContent = TRANSLATE('@(Save draft)');
```

The key is computed from the exact English text, never by hand. Do not put parentheses inside a phrase: the framework would cut it there. `node bin/translations.js` lists what is missing in each language file and `node bin/translations.js --add` adds the English text to all of them so you can translate it.

Translate whole phrases and format afterwards (`TRANSLATE('@({0} messages)').format(count)`); use separate phrases for singular and plural; never translate HTML that already contains mail text.
