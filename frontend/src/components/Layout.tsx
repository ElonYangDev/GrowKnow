import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  Boxes,
  ChevronRight,
  Library,
  Loader2,
  Menu,
  Plus,
  Settings2,
  X,
} from 'lucide-react'
import { useApp } from '../store'
import { useI18n } from '../i18n'
import { ToastStack } from './ui'

const KIND_COLOR: Record<string, string> = {
  vector: '#4f9c82',
  triple: '#d3a05c',
  graph: '#7d8fd0',
}

export default function Layout() {
  const { kbs, kbsLoading } = useApp()
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  return (
    <div className="shell">
      <button className="mobile-menu" onClick={() => setOpen(true)} aria-label={t('layout.openMenu')}>
        <Menu size={20} />
      </button>
      {open ? <div className="sidebar-scrim" onClick={() => setOpen(false)} /> : null}
      <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark" aria-hidden>
            <img src="/logo.svg" width="38" height="38" alt="" />
          </div>
          <div>
            <div className="brand-name">GrowKnow</div>
          </div>
          <button className="sidebar-close" onClick={() => setOpen(false)} aria-label={t('layout.closeMenu')}>
            <X size={18} />
          </button>
        </div>

        <div className="nav-section">
          <div className="nav-heading">
            <span>{t('layout.kbHeading')}</span>
            <NavLink to="/new" className="nav-add" title={t('layout.newKb')} onClick={() => setOpen(false)}>
              <Plus size={15} />
            </NavLink>
          </div>
          <div className="kb-nav">
            {kbsLoading ? (
              <div className="nav-loading">
                <Loader2 size={14} className="spin" /> {t('common.loading')}
              </div>
            ) : kbs.length === 0 ? (
              <NavLink to="/new" className="nav-empty" onClick={() => setOpen(false)}>
                <span>{t('layout.noKb')}</span>
                <span className="nav-empty-cta">
                  {t('layout.createFirst')} <ChevronRight size={13} />
                </span>
              </NavLink>
            ) : (
              kbs.map((kb) => (
                <NavLink
                  key={kb.id}
                  to={`/kb/${kb.kb_key}`}
                  className={({ isActive }) => `kb-nav-item ${isActive ? 'active' : ''}`}
                  onClick={() => setOpen(false)}
                >
                  <i className="kb-dot" style={{ background: KIND_COLOR[kb.kind] ?? '#999' }} />
                  <span className="kb-nav-name">{kb.name}</span>
                  {kb.pending_count > 0 ? (
                    <span
                      className="kb-pending"
                      title={t('layout.pendingFiles', { n: kb.pending_count })}
                    >
                      <Loader2 size={11} className="spin" />
                    </span>
                  ) : (
                    <span className="kb-nav-count">{kb.file_count}</span>
                  )}
                </NavLink>
              ))
            )}
          </div>
        </div>

        <nav className="nav-section nav-lower">
          <NavLink to="/new" className="nav-item" onClick={() => setOpen(false)}>
            <Plus size={17} />
            <span>{t('layout.newKb')}</span>
          </NavLink>
          <NavLink to="/skills" className="nav-item" onClick={() => setOpen(false)}>
            <Boxes size={17} />
            <span>{t('layout.skills')}</span>
          </NavLink>
          <NavLink to="/settings" className="nav-item" onClick={() => setOpen(false)}>
            <Settings2 size={17} />
            <span>{t('layout.settings')}</span>
          </NavLink>
        </nav>

        <div className="sidebar-foot">
          <Library size={13} />
          <span>{t('layout.footer')}</span>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
      <ToastStack />
    </div>
  )
}
