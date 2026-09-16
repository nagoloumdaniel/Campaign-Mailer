/*
 * The theme, before the first paint.
 *
 * A separate file rather than an inline script, and loaded without `defer` so
 * it runs before the document is painted. Inline would have meant either
 * `'unsafe-inline'` in the script policy or a hash that any whitespace change
 * would silently invalidate; a file is covered by `script-src 'self'` and
 * cannot drift.
 *
 * Run here rather than in React: the application renders only once its bundle
 * has parsed, and a dark-mode user would watch a white page for that whole
 * time. The attribute is always written, never left absent, because the
 * `dark:` variant in the stylesheet is an attribute selector.
 */
;(function () {
  try {
    var saved = localStorage.getItem('cm-theme')
    var resolved =
      saved === 'light' || saved === 'dark'
        ? saved
        : window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'

    document.documentElement.dataset.theme = resolved
    document.documentElement.style.colorScheme = resolved
  } catch {
    // Blocked storage, a private window: the light default already stands on
    // the element, and nothing else here has to succeed.
  }
})()
