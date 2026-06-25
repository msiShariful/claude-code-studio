import { useMemo } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Api } from './api.js'
import { Shell } from './shell/Shell.js'
import { UsageApp } from './usage/UsageApp.js'

export function App({ token }: { token: string | null }) {
  const api = useMemo(() => (token ? new Api(token) : null), [token])

  if (!api) {
    return (
      <main className="gate">
        <h1 className="wordmark">Claude Code Studio</h1>
        <p>
          No session token found. Start the app from your terminal with <code>npx cc-studio</code>{' '}
          and open the URL it prints — the token rides along in that URL.
        </p>
      </main>
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* Usage is its own self-contained area with its own chrome and design. */}
        <Route path="/usage/*" element={<UsageApp token={token!} />} />
        <Route path="*" element={<Shell api={api} />} />
      </Routes>
    </BrowserRouter>
  )
}
