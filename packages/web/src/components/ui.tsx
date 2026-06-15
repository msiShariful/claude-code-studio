import type { ReactNode } from 'react'

/**
 * Small, dependency-free design-system primitives. Every view composes these so
 * the app looks consistent and a new contributor never has to hand-roll chrome.
 */

/** An ℹ️ affordance that reveals a plain-language explanation on hover/focus. */
export function InfoTip({ text, label }: { text: string; label?: string }) {
  return (
    <span
      className="infotip"
      tabIndex={0}
      role="note"
      aria-label={label ? `${label}. ${text}` : text}
    >
      <span className="infotip-icon" aria-hidden="true">
        i
      </span>
      <span className="infotip-bubble" role="tooltip">
        {text}
      </span>
    </span>
  )
}

export type Tone = 'ok' | 'warn' | 'muted' | 'danger'

export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>
}

/** A page heading with an optional info tooltip and a right-aligned actions slot. */
export function PageHeader({
  title,
  info,
  label,
  actions,
}: {
  title: string
  info?: string
  label?: string
  actions?: ReactNode
}) {
  return (
    <header className="page-header">
      <div className="page-header-title">
        <h2>{title}</h2>
        {info && <InfoTip text={info} label={label ?? title} />}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  )
}

export function Card({
  className = '',
  onClick,
  children,
}: {
  className?: string
  onClick?: () => void
  children: ReactNode
}) {
  if (onClick) {
    return (
      <button type="button" className={`ui-card clickable ${className}`} onClick={onClick}>
        {children}
      </button>
    )
  }
  return <div className={`ui-card ${className}`}>{children}</div>
}

export function EmptyState({
  title,
  children,
}: {
  title: string
  children?: ReactNode
}) {
  return (
    <div className="empty-state">
      <p className="empty-title">{title}</p>
      {children}
    </div>
  )
}
