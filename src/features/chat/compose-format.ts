// Pure composer helpers shared by the message composer (Task 14). Kept free of
// React / DOM so they are unit-testable and reusable: `wrapSelection` powers the
// formatting toolbar + keyboard shortcuts, and `detectTrigger` is the single
// autocomplete-trigger scanner behind BOTH `@`-mentions and `:emoji:` completion.

// Result of a formatting action: the new textarea value plus the selection range
// the caller should restore (so the wrapped text stays selected / the caret lands
// in the useful spot). Bounds are indices into the returned `value`.
export type WrapResult = { value: string; selStart: number; selEnd: number }

// Wrap (or prefix) the `[start, end)` selection of `value` according to `marker`:
//   • symmetric inline markers (`**`, `_`, `~`, `` ` ``) → marker+selection+marker,
//     leaving the original text selected between the markers;
//   • link (`[]()`) → `[selection](url)` with the `url` placeholder selected so the
//     user can type the destination immediately;
//   • line-prefix markers (any marker ending in a space, e.g. `- `, `> `) → inserted
//     once at the start of the selection's line (list item / block quote).
// Empty selections still work: symmetric markers drop the caret between them, the
// link seeds `[text](url)`, and a line prefix is added to the current line.
export function wrapSelection(value: string, start: number, end: number, marker: string): WrapResult {
  const selected = value.slice(start, end)

  // Link: `[label](url)` with the url placeholder selected.
  if (marker === '[]()') {
    const label = selected || 'text'
    const head = value.slice(0, start) + '[' + label + ']('
    const url = 'url'
    const next = head + url + ')' + value.slice(end)
    return { value: next, selStart: head.length, selEnd: head.length + url.length }
  }

  // Line-prefix markers (list, quote): insert once at the start of the current line.
  if (marker.endsWith(' ')) {
    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    const next = value.slice(0, lineStart) + marker + value.slice(lineStart)
    return { value: next, selStart: start + marker.length, selEnd: end + marker.length }
  }

  // Symmetric inline markers: wrap and keep the inner text selected.
  const next = value.slice(0, start) + marker + selected + marker + value.slice(end)
  return { value: next, selStart: start + marker.length, selEnd: end + marker.length }
}

// Scan back from `caret` for a `char` (`@` or `:`) that opens an autocomplete
// query. The trigger must sit at a word boundary (start-of-input or after
// whitespace); the query is the run of id-safe chars (`[A-Za-z0-9_-]`) between the
// trigger and the caret. Returns the query text and the trigger's index (`from`),
// or null when no valid trigger precedes the caret. Generalizes the original
// `detectMention` so mentions and `:emoji:` share one implementation.
export function detectTrigger(
  value: string,
  caret: number,
  char: '@' | ':',
): { query: string; from: number } | null {
  let i = caret - 1
  while (i >= 0 && /[a-zA-Z0-9_-]/.test(value[i])) i--
  if (i < 0 || value[i] !== char) return null
  const before = i === 0 ? '' : value[i - 1]
  if (before && !/\s/.test(before)) return null
  return { query: value.slice(i + 1, caret), from: i }
}
