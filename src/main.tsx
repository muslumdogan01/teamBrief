import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './ConnectedApp.tsx'
import { getBrowserConfig } from './supabase-client.ts'

const config = getBrowserConfig()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App config={config} />
  </StrictMode>,
)
