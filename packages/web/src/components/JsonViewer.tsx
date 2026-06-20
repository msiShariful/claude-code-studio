import { lazy, Suspense } from 'react'

// Read-only, syntax-highlighted JSON with line numbers + a fold gutter — the same
// CodeMirror viewer the file editor uses, lazy-loaded so CM stays out of the main bundle.
const CodeEditor = lazy(() =>
  import('./CodeEditor.js').then((m) => ({ default: m.CodeEditor })),
)

export function JsonViewer({ value }: { value: string }) {
  return (
    <Suspense fallback={<pre className="code">Loading…</pre>}>
      <CodeEditor value={value} language="json" readOnly />
    </Suspense>
  )
}
