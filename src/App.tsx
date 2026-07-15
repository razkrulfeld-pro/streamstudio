import { AppShell } from '@/components/app-shell'
import { AuthCallbackPage } from '@/pages/auth-callback-page'
import { EditorStudioPage } from '@/pages/editor-studio-page'
import { LobbyPage } from '@/pages/lobby-page'
import { RecordingSessionPage } from '@/pages/recording-session-page'
import { SettingsPage } from '@/pages/settings-page'
import { Navigate, Route, Routes } from 'react-router-dom'

function App() {
  return (
    <Routes>
      <Route path="record" element={<RecordingSessionPage />} />
      <Route path="auth/callback" element={<AuthCallbackPage />} />
      <Route element={<AppShell />}>
        <Route index element={<LobbyPage />} />
        <Route path="editor-studio" element={<EditorStudioPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default App
