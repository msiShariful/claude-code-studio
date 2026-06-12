import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import '@fontsource/instrument-serif/400-italic.css'
import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { bootstrapToken } from './api.js'
import { App } from './App.js'

const token = bootstrapToken(window)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App token={token} />
  </StrictMode>,
)
