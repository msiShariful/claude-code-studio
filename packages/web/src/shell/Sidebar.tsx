import { InfoTip } from '../components/ui.js'
import { sectionsFor } from '../nav.js'
import type { WorkspaceKind } from '../workspace.js'

/**
 * Section navigation for the active workspace. Plain-language labels with an
 * info tooltip on each, so a newcomer learns the underlying Claude concept
 * without the sidebar shouting jargon.
 */
export function Sidebar({
  kind,
  active,
  onOpen,
}: {
  kind: WorkspaceKind
  active: string
  onOpen: (section: string) => void
}) {
  return (
    <nav className="section-nav" aria-label="Sections">
      {sectionsFor(kind).map((s) => (
        <div className={s.key === active ? 'nav-item active' : 'nav-item'} key={s.key}>
          <button className="nav-link" onClick={() => onOpen(s.key)}>
            {s.label}
          </button>
          <InfoTip text={s.info} label={`${s.label} (${s.tech})`} />
        </div>
      ))}
    </nav>
  )
}
