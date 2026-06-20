// Tiny inline-SVG icon set for the file-tree sidebar. Crisp at 14px, themeable
// via `currentColor` (the colour comes from the wrapping `.ic-*` class), and
// stroke-only so every glyph carries the same visual weight.

import type { ReactElement } from 'react'

export type TreeIcon = 'folder' | 'md' | 'json' | 'layers' | 'history'

const svgProps = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

/** A right-pointing caret; the row rotates it to 90° when the folder is open. */
export function Caret({ open }: { open: boolean }) {
  return (
    <span className={`tree-caret${open ? ' open' : ''}`} aria-hidden="true">
      <svg {...svgProps}>
        <path d="M6 4l4 4-4 4" />
      </svg>
    </span>
  )
}

const PATHS: Record<TreeIcon, ReactElement> = {
  // a directory
  folder: <path d="M2 5.2a1 1 0 0 1 1-1h3l1.3 1.4H13a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />,
  // a text document, folded corner + lines  (.md / memory)
  md: (
    <>
      <path d="M4 2.5h4.5L12 6v7a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 4 13z" />
      <path d="M8.4 2.6V6H12" />
      <path d="M6 8.5h4M6 10.5h4" />
    </>
  ),
  // curly braces  (.json / structured config)
  json: (
    <>
      <path d="M6.4 3C5.4 3 5.2 3.7 5.2 4.6v1.5c0 .9-.5 1.1-1.1 1.9.6.8 1.1 1 1.1 1.9V13" />
      <path d="M9.6 3c1 0 1.2.7 1.2 1.6v1.5c0 .9.5 1.1 1.1 1.9-.6.8-1.1 1-1.1 1.9V13" />
    </>
  ),
  // overlapping panes  (effective = merged layers)
  layers: (
    <>
      <rect x="2.7" y="2.7" width="7.6" height="7.6" rx="1.4" />
      <path d="M5.7 13.3h6a1.6 1.6 0 0 0 1.6-1.6v-6" />
    </>
  ),
  // a restore-from-history arrow
  history: (
    <>
      <path d="M3.4 8a4.6 4.6 0 1 1 1.2 3.1" />
      <path d="M3.2 9.4 3 11.8l2.4-.2" />
      <path d="M8 5.6V8l1.9 1.2" />
    </>
  ),
}

export function Glyph({ name }: { name: TreeIcon }) {
  return (
    <svg {...svgProps} className="tree-glyph">
      {PATHS[name]}
    </svg>
  )
}
