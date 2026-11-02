import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Link } from 'react-router-dom'
import Layout from './components/Layout'
import { EmptyState } from './components/ui'
import { I18nProvider, useI18n } from './i18n'
import { AppProvider } from './store'
import KbListPage from './pages/KbListPage'
import KbPage from './pages/KbPage'
import NewKbPage from './pages/NewKbPage'
import SettingsPage from './pages/SettingsPage'
import SkillsPage from './pages/SkillsPage'

function NotFound() {
  const { t } = useI18n()
  return (
    <div className="page">
      <EmptyState
        title={t('app.notFoundTitle')}
        hint={t('app.notFoundHint')}
        action={
          <Link to="/kb" className="btn btn-primary">
            {t('app.notFoundAction')}
          </Link>
        }
      />
    </div>
  )
}

export default function App() {
  return (
    <I18nProvider>
      <BrowserRouter>
        <AppProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Navigate to="/kb" replace />} />
              <Route path="kb" element={<KbListPage />} />
              <Route path="kb/:kbKey" element={<KbPage />} />
              <Route path="new" element={<NewKbPage />} />
              <Route path="skills" element={<SkillsPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </AppProvider>
      </BrowserRouter>
    </I18nProvider>
  )
}
