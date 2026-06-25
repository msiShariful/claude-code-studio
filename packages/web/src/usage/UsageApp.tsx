import '@fontsource/space-grotesk/400.css'
import '@fontsource/space-grotesk/500.css'
import '@fontsource/space-grotesk/600.css'
import './usage.css'
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { DEFAULT_SECTION, USAGE_SECTIONS } from './nav.js'
import { UsageApi } from './usageApi.js'
import { Overview } from './views/Overview.js'
import { Timeline } from './views/Timeline.js'
import { Models } from './views/Models.js'
import { Projects } from './views/Projects.js'
import { Sessions } from './views/Sessions.js'
import { Windows } from './views/Windows.js'
import { Prompts } from './views/Prompts.js'

const PRICING_NOTE = 'Estimated from local logs · Anthropic rates, April 2026'
const LAST_CONFIG_ROUTE = 'ccs-last-route'

function viewFor(key: string, api: UsageApi) {
  switch (key) {
    case 'timeline':
      return <Timeline api={api} />
    case 'models':
      return <Models api={api} />
    case 'projects':
      return <Projects api={api} />
    case 'sessions':
      return <Sessions api={api} />
    case 'windows':
      return <Windows api={api} />
    case 'prompts':
      return <Prompts api={api} />
    default:
      return <Overview api={api} />
  }
}

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return <span className="u-clock">{now.toLocaleTimeString()}</span>
}

export function UsageApp({ token }: { token: string }) {
  const api = useMemo(() => new UsageApi(token), [token])
  const navigate = useNavigate()
  const location = useLocation()

  const parts = location.pathname.split('/').filter(Boolean)
  const requested = parts[1] ?? DEFAULT_SECTION
  const active = USAGE_SECTIONS.some((s) => s.key === requested) ? requested : DEFAULT_SECTION
  const section = USAGE_SECTIONS.find((s) => s.key === active)!

  function toConfigure() {
    const last = window.localStorage.getItem(LAST_CONFIG_ROUTE)
    navigate(last && !last.startsWith('/usage') ? last : '/global')
  }

  return (
    <div className="usage">
      <header className="u-topbar">
        <div className="u-topbar-left">
          <span className="u-wordmark">Claude Code Studio</span>
          <div className="u-areaswitch" role="tablist" aria-label="Area">
            <button role="tab" aria-selected="false" onClick={toConfigure}>
              Configure
            </button>
            <button role="tab" aria-selected="true" className="on">
              Usage
            </button>
          </div>
        </div>
        <div className="u-topbar-right">
          <Clock />
        </div>
      </header>

      <div className="u-body">
        <aside className="u-sidebar">
          <nav aria-label="Usage sections">
            {USAGE_SECTIONS.map((s) => (
              <button
                key={s.key}
                className={`u-navitem ${s.key === active ? 'active' : ''}`}
                onClick={() => navigate(`/usage/${s.key}`)}
              >
                {s.label}
              </button>
            ))}
          </nav>
        </aside>

        <main className="u-content">
          <header className="u-pagehead">
            <div>
              <h1 className="u-pagetitle">{section.label}</h1>
              <p className="u-pageblurb">{section.blurb}</p>
            </div>
            <span className="u-pricing-note">{PRICING_NOTE}</span>
          </header>
          <div key={active}>{viewFor(active, api)}</div>
        </main>
      </div>
    </div>
  )
}
