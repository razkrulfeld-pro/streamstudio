import { RecordingsProvider } from '@/context/recordings-context'
import { AssetLibraryProvider } from '@/context/asset-library-context'
import { SettingsProvider } from '@/context/settings-context'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <SettingsProvider>
        <AssetLibraryProvider>
          <RecordingsProvider>
            <App />
          </RecordingsProvider>
        </AssetLibraryProvider>
      </SettingsProvider>
    </BrowserRouter>
  </StrictMode>,
)
