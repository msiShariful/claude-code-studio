import { useEffect, useRef } from 'react'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import { basicSetup } from 'codemirror'

export type CodeLanguage = 'markdown' | 'json' | 'text'

/**
 * A small CodeMirror 6 wrapper used for editing config files: a line-number gutter,
 * a fold gutter (collapse markdown sections / JSON blocks), and syntax highlighting,
 * all themed to the app's dark palette. Controlled — `value` in, `onChange` out.
 */
function languageExtension(language: CodeLanguage) {
  if (language === 'markdown') return markdown()
  if (language === 'json') return json()
  return []
}

// Chrome (background, gutters, fold markers, selection) in the app's tokens.
const theme = EditorView.theme(
  {
    '&': {
      backgroundColor: '#0a0c0e',
      color: '#ededf0',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: '8px',
      fontSize: '0.8rem',
    },
    '&.cm-focused': { outline: '2px solid #ffb454', outlineOffset: '-1px' },
    '.cm-scroller': {
      fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
      lineHeight: '1.6',
      maxHeight: '32rem',
    },
    '.cm-content': { padding: '0.6rem 0', caretColor: '#ffb454' },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: '#8b8d98',
      border: 'none',
      borderRight: '1px solid rgba(255,255,255,0.08)',
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 0.5rem 0 0.75rem', opacity: '0.6' },
    '.cm-foldGutter .cm-gutterElement': { color: '#8b8d98', cursor: 'pointer' },
    '.cm-foldGutter .cm-gutterElement:hover': { color: '#ffb454' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.03)' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.03)', color: '#ededf0' },
    '.cm-cursor': { borderLeftColor: '#ffb454' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(255,180,84,0.18)',
    },
    '.cm-foldPlaceholder': {
      backgroundColor: 'rgba(255,180,84,0.12)',
      border: 'none',
      color: '#8b8d98',
      padding: '0 0.4rem',
      borderRadius: '4px',
    },
  },
  { dark: true },
)

// Token colours — headings/strings/keys tied to the same meaning palette as the file tree.
const highlight = HighlightStyle.define([
  { tag: t.heading, color: '#ffb454', fontWeight: '600' },
  { tag: t.strong, color: '#ededf0', fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: [t.link, t.url], color: '#6fd0bd', textDecoration: 'underline' },
  { tag: [t.monospace, t.contentSeparator], color: '#b3a4f5' },
  { tag: t.keyword, color: '#b3a4f5' },
  { tag: [t.string, t.special(t.string)], color: '#a3cf6b' },
  { tag: [t.number, t.bool, t.null], color: '#6fd0bd' },
  { tag: t.propertyName, color: '#b3a4f5' },
  { tag: [t.comment, t.quote], color: '#8b8d98', fontStyle: 'italic' },
  { tag: [t.list, t.processingInstruction], color: '#ffb454' },
])

export function CodeEditor({
  value,
  onChange,
  language = 'text',
  disabled = false,
  readOnly = false,
  minHeight,
}: {
  value: string
  onChange?: (next: string) => void
  language?: CodeLanguage
  /** transiently non-editable (e.g. while a save is in flight) */
  disabled?: boolean
  /** a permanent read-only viewer (still folds, scrolls, and highlights) */
  readOnly?: boolean
  /** a comfortable minimum editor height (e.g. '22rem') — viewers size to content */
  minHeight?: string
}) {
  const noEdit = disabled || readOnly
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const editable = useRef(new Compartment())

  // Create the editor once; external `value`/`disabled` are synced below.
  useEffect(() => {
    if (!host.current) return
    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        languageExtension(language),
        syntaxHighlighting(highlight),
        theme,
        ...(minHeight ? [EditorView.theme({ '.cm-scroller': { minHeight } })] : []),
        EditorView.lineWrapping,
        editable.current.of([EditorState.readOnly.of(noEdit), EditorView.editable.of(!noEdit)]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current?.(u.state.doc.toString())
        }),
      ],
    })
    const v = new EditorView({ state, parent: host.current })
    view.current = v
    return () => {
      v.destroy()
      view.current = null
    }
    // language is fixed per file kind; remount (via React key) on file change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language])

  // Push external value changes (opening a different file) into the editor.
  useEffect(() => {
    const v = view.current
    if (!v) return
    const current = v.state.doc.toString()
    if (value !== current) {
      v.dispatch({ changes: { from: 0, to: current.length, insert: value } })
    }
  }, [value])

  // Toggle editability (e.g. while a save is in flight) without rebuilding the editor.
  useEffect(() => {
    view.current?.dispatch({
      effects: editable.current.reconfigure([
        EditorState.readOnly.of(noEdit),
        EditorView.editable.of(!noEdit),
      ]),
    })
  }, [noEdit])

  return <div ref={host} className="code-editor" />
}
