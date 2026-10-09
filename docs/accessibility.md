# Accessibility

The target is WCAG 2.2 level AA. This is what the app aims for and what has not been checked yet. It was tested with axe-core (light and dark, every window), a keyboard walk, 320 px reflow and text spacing.

## What the app does

- **Names and structure.** Every control has an accessible name (icon buttons carry an `aria-label`); the fields drawn by jComponent are tied to their labels, and dropdowns are named by label and value. Landmarks: `aside` and `nav` (folders), `main`, `section` (message list, message reading); one `h1` (the list title) and the message subject as `h2`. Every dialog has `role="dialog"`, `aria-modal` and a label.
- **Keyboard.** Everything works without a mouse: a *Skip to the message list* link, shortcuts (`?` lists them: `J`/`K` move, `X` selects, `R`/`A`/`F` reply, reply all, forward, `E` archive, `#` trash, `S` star, `U` unread, `Z` undo, `N`/`C` new, `/` search), a **Show more** button for long lists (no hidden infinite scroll), row checkboxes with Shift for ranges. Focus goes into a dialog when it opens, stays inside it, and returns to where it was when it closes (`Esc`). One focus ring, on the field's control, 2 px, 3:1 against the surface in light and dark.
- **Screen readers.** A message line reads *state, sender, subject, date, account* ("Unread, Starred, …"); folders read their count; filters and switches say whether they are pressed or on. New mail is announced in a polite status line whether or not system notifications are on; toasts are a polite live region and stay 7 seconds; the suggestions of an address field announce the active option (`aria-activedescendant`).
- **Sight.** Text is 4.5:1 or better in light and dark (the colours are variables with a checked pair for each); the two-line message preview is the only text that is cut, and the whole message is a click away. Reflow works down to 320 px with no horizontal scroll, text spacing of 1.5 / 0.12 em / 0.16 em loses nothing, the page is usable at 200 % zoom, targets are at least 24 px, and nothing relies on colour alone (unread is bold, a dot and a word).
- **Motion and contrast modes.** `prefers-reduced-motion` removes transitions; `forced-colors` keeps switches and selections visible.
- **Forms.** Login uses `username` / `current-password` / `one-time-code` autocomplete; errors are `role="alert"` and say what to do.

## Not checked

A real screen reader (VoiceOver, NVDA, TalkBack): names and roles come from the accessibility attributes, not from listening. Safari, Firefox and a real phone. Windows high-contrast mode (the `forced-colors` rules are written, not seen). Voice control.
