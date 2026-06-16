import { useCallback, useEffect, useState, type ReactNode } from 'react'

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

export interface ConfirmOptions {
  title: string
  body?: ReactNode
  confirmLabel?: string
  /** Style the confirm button as destructive (red). */
  danger?: boolean
}

/** A modal confirmation, replacing the browser's `window.confirm`. */
export function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Confirm',
  danger,
  onConfirm,
  onCancel,
}: ConfirmOptions & { onConfirm: () => void; onCancel: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="modal-overlay" role="presentation" onClick={onCancel}>
      <div
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="modal-title">{title}</h3>
        {body && <div className="modal-body">{body}</div>}
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={danger ? 'action danger' : 'action'}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Imperative confirm: `await confirm({title, …})` resolves true/false. Render the
 * returned `confirmDialog` once in the component so a single modal serves every call.
 */
export function useConfirm(): {
  confirm: (opts: ConfirmOptions) => Promise<boolean>
  confirmDialog: ReactNode
} {
  const [request, setRequest] = useState<
    (ConfirmOptions & { resolve: (ok: boolean) => void }) | null
  >(null)

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setRequest({ ...opts, resolve })),
    [],
  )

  const settle = (ok: boolean) => {
    if (request) request.resolve(ok)
    setRequest(null)
  }

  const confirmDialog = request ? (
    <ConfirmDialog
      title={request.title}
      body={request.body}
      confirmLabel={request.confirmLabel}
      danger={request.danger}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null

  return { confirm, confirmDialog }
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
