import { useId, useState } from 'react'
import type { SettingDef } from '../settingsCatalog.js'

/**
 * Renders the one right control for a catalog setting — a toggle, dropdown,
 * field, list, or key/value map — and reports the typed value back up. Pure: it
 * holds no settings state of its own beyond the small "new row" input buffers,
 * so the Editor owns the pending-edit truth.
 */
export function SettingControl({
  def,
  value,
  onChange,
}: {
  def: SettingDef
  value: unknown
  onChange: (next: unknown) => void
}) {
  switch (def.type) {
    case 'boolean':
      return <Toggle checked={value === true} label={def.title} onChange={onChange} />
    case 'enum':
      return <EnumSelect def={def} value={value} onChange={onChange} />
    case 'number':
      return <NumberField def={def} value={value} onChange={onChange} />
    case 'stringList':
      return <ListEditor def={def} value={asStringList(value)} onChange={onChange} />
    case 'stringMap':
      return <MapEditor value={asStringMap(value)} onChange={onChange} />
    default:
      return <StringField def={def} value={value} onChange={onChange} />
  }
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}
function asStringList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : []
}
function asStringMap(v: unknown): Record<string, string> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {}
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, String(x)]))
}

function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-knob" />
    </button>
  )
}

function EnumSelect({
  def,
  value,
  onChange,
}: {
  def: SettingDef
  value: unknown
  onChange: (v: string) => void
}) {
  const current = asString(value)
  const options = def.options ?? []
  // Surface an out-of-catalog current value (e.g. a custom output style) so the
  // dropdown never silently misrepresents what's on disk.
  const known = options.some((o) => o.value === current)
  return (
    <select
      aria-label={def.title}
      value={current}
      onChange={(e) => onChange(e.target.value)}
    >
      {current === '' && <option value="">default</option>}
      {!known && current !== '' && <option value={current}>{current} (custom)</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label ?? o.value}
          {o.hint ? ` — ${o.hint}` : ''}
        </option>
      ))}
    </select>
  )
}

function StringField({
  def,
  value,
  onChange,
}: {
  def: SettingDef
  value: unknown
  onChange: (v: string) => void
}) {
  const listId = useId()
  return (
    <>
      <input
        className="set-field"
        aria-label={def.title}
        placeholder={def.placeholder}
        value={asString(value)}
        list={def.suggestions ? listId : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {def.suggestions && (
        <datalist id={listId}>
          {def.suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </>
  )
}

function NumberField({
  def,
  value,
  onChange,
}: {
  def: SettingDef
  value: unknown
  onChange: (v: number | undefined) => void
}) {
  return (
    <input
      className="set-field set-number"
      type="number"
      aria-label={def.title}
      placeholder={def.placeholder}
      value={typeof value === 'number' ? String(value) : ''}
      onChange={(e) => {
        const n = Number(e.target.value)
        onChange(e.target.value === '' || Number.isNaN(n) ? undefined : n)
      }}
    />
  )
}

function ListEditor({
  def,
  value,
  onChange,
}: {
  def: SettingDef
  value: string[]
  onChange: (v: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  function add() {
    const v = draft.trim()
    if (v === '') return
    onChange([...value, v])
    setDraft('')
  }
  return (
    <div className="list-editor">
      {value.length > 0 && (
        <ul className="chip-list">
          {value.map((item, i) => (
            <li className="chip removable" key={`${item}-${i}`}>
              <span className="chip-text">{item}</span>
              <button
                type="button"
                aria-label={`Remove ${item}`}
                className="chip-x"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="list-add">
        <input
          aria-label={`Add to ${def.title}`}
          placeholder={def.placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
        />
        <button type="button" className="ghost" onClick={add}>
          Add
        </button>
      </div>
    </div>
  )
}

function MapEditor({
  value,
  onChange,
}: {
  value: Record<string, string>
  onChange: (v: Record<string, string>) => void
}) {
  const [k, setK] = useState('')
  const [v, setV] = useState('')
  const entries = Object.entries(value)
  function add() {
    const key = k.trim()
    if (key === '') return
    onChange({ ...value, [key]: v })
    setK('')
    setV('')
  }
  return (
    <div className="map-editor">
      {entries.length > 0 && (
        <ul className="kv-rows">
          {entries.map(([key, val]) => (
            <li className="kv-row" key={key}>
              <span className="kv-key">{key}</span>
              <input
                aria-label={`Value for ${key}`}
                value={val}
                onChange={(e) => onChange({ ...value, [key]: e.target.value })}
              />
              <button
                type="button"
                aria-label={`Remove ${key}`}
                className="chip-x"
                onClick={() => {
                  const next = { ...value }
                  delete next[key]
                  onChange(next)
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="kv-add">
        <input aria-label="New variable name" placeholder="NAME" value={k} onChange={(e) => setK(e.target.value)} />
        <input aria-label="New variable value" placeholder="value" value={v} onChange={(e) => setV(e.target.value)} />
        <button type="button" className="ghost" onClick={add}>
          Add
        </button>
      </div>
    </div>
  )
}
