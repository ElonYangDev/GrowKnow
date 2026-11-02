import { Link } from 'react-router-dom'
import { ArrowUpRight, BookOpen, Layers, Loader2, Plus, Waypoints } from 'lucide-react'
import { useI18n } from '../i18n'
import { useApp, formatTime } from '../store'
import { EmptyState, KindBadge } from '../components/ui'
import type { KbKind } from '../types'

const KIND_ICON: Record<KbKind, typeof BookOpen> = {
  vector: BookOpen,
  triple: Layers,
  graph: Waypoints,
}

export default function KbListPage() {
  const { kbs, kbsLoading } = useApp()
  const { t } = useI18n()

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Knowledge bases</p>
          <h1 className="page-title">{t('kbList.title')}</h1>
          <p className="page-desc">{t('kbList.desc')}</p>
        </div>
        <Link to="/new" className="btn btn-primary">
          <Plus size={16} />
          {t('kbList.newKb')}
        </Link>
      </header>

      {kbsLoading ? (
        <div className="list-loading">
          <Loader2 size={18} className="spin" /> {t('kbList.loading')}
        </div>
      ) : kbs.length === 0 ? (
        <EmptyState
          icon={<BookOpen size={26} />}
          title={t('kbList.emptyTitle')}
          hint={t('kbList.emptyHint')}
          action={
            <Link to="/new" className="btn btn-primary">
              <Plus size={16} />
              {t('kbList.emptyAction')}
            </Link>
          }
        />
      ) : (
        <div className="kb-grid">
          {kbs.map((kb) => {
            const Icon = KIND_ICON[kb.kind]
            return (
              <Link key={kb.id} to={`/kb/${kb.kb_key}`} className={`kb-card kb-card-${kb.kind}`}>
                <div className="kb-card-top">
                  <span className="kb-card-icon">
                    <Icon size={19} />
                  </span>
                  <KindBadge kind={kb.kind} />
                  <ArrowUpRight size={16} className="kb-card-arrow" />
                </div>
                <h2>{kb.name}</h2>
                <p className="kb-card-desc">{kb.description || t('kbList.noDesc')}</p>
                <div className="kb-card-stats">
                  <span>
                    <b>{kb.file_count}</b> {t('kbList.filesUnit', { n: kb.file_count })}
                  </span>
                  <span>
                    <b>{kb.knowledge_count.toLocaleString()}</b>{' '}
                    {t('kbList.knowledgeUnit', { n: kb.knowledge_count })}
                  </span>
                  {kb.kind === 'graph' && kb.graph_stats ? (
                    <span>
                      <b>{kb.graph_stats.nodes}</b>{' '}
                      {t('kbList.entitiesUnit', { n: kb.graph_stats.nodes })}
                    </span>
                  ) : null}
                  {kb.pending_count > 0 ? (
                    <span className="kb-card-running">
                      <Loader2 size={12} className="spin" /> {t('kbList.pending', { n: kb.pending_count })}
                    </span>
                  ) : null}
                </div>
                <div className="kb-card-foot">
                  {t('kbList.updated', { time: formatTime(kb.updated_at) })}
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
