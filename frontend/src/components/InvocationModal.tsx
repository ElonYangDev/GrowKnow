import { useEffect, useMemo, useState } from 'react'
import { FlaskConical, Loader2, Search } from 'lucide-react'
import { api, ApiError } from '../api'
import { useI18n } from '../i18n'
import { useApp } from '../store'
import type { Invocations, Kb, SearchResponse } from '../types'
import { CopyButton, EmptyState, Modal } from './ui'

type Tab = 'python' | 'javascript' | 'http'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'python', label: 'Python' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'http', label: 'HTTP' },
]

export default function InvocationModal({
  open,
  kb,
  onClose,
}: {
  open: boolean
  kb: Kb
  onClose: () => void
}) {
  const { notify } = useApp()
  const { t } = useI18n()
  const [tab, setTab] = useState<Tab>('python')
  const [data, setData] = useState<Invocations | null>(null)
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<SearchResponse | null>(null)

  useEffect(() => {
    if (!open) return
    setTab('python')
    setResult(null)
    setQuery('')
    setLoading(true)
    api
      .invocations(kb.kb_key)
      .then(setData)
      .catch((error) => notify(error instanceof ApiError ? error.message : t('inv.loadFailed'), 'error'))
      .finally(() => setLoading(false))
  }, [open, kb.kb_key, notify, t])

  const code = useMemo(() => {
    if (!data) return ''
    return tab === 'python' ? data.python : tab === 'javascript' ? data.javascript : data.http
  }, [data, tab])

  const run = async () => {
    if (!query.trim()) {
      notify(t('inv.needQuery'), 'error')
      return
    }
    setTesting(true)
    try {
      const response = await api.search(kb.kb_key, { query: query.trim(), top_k: 5 })
      setResult(response)
    } catch (error) {
      notify(error instanceof ApiError ? error.message : t('inv.searchFailed'), 'error')
    } finally {
      setTesting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('inv.title')}
      subtitle={t('inv.subtitle', { name: kb.name })}
      width={860}
    >
      <div className="endpoint-row">
        <code>{data?.url ?? `/api/v1/kb/${kb.kb_key}/search`}</code>
        <CopyButton text={data?.url ?? ''} label={t('common.copyUrl')} />
      </div>

      <div className="tabs">
        {TABS.map((item) => (
          <button
            key={item.id}
            className={`tab ${tab === item.id ? 'active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
        <span className="tabs-spacer" />
        <CopyButton text={code} label={t('common.copyCode')} />
      </div>
      {loading ? (
        <div className="code-block loading">
          <Loader2 size={16} className="spin" /> {t('inv.generating')}
        </div>
      ) : (
        <pre className="code-block">{code}</pre>
      )}

      <section className="test-panel">
        <div className="test-head">
          <h3>
            <FlaskConical size={16} /> {t('inv.testTitle')}
          </h3>
          <span>
            {kb.kind === 'graph'
              ? t('inv.graphDesc')
              : kb.kind === 'triple'
                ? t('inv.tripleDesc')
                : t('inv.vectorDesc')}
          </span>
        </div>
        <div className="search-bar">
          <Search size={16} />
          <input
            className="input"
            placeholder={kb.kind === 'graph' ? t('inv.queryGraph') : t('inv.queryOther')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void run()
            }}
          />
          <button className="btn btn-primary btn-sm" onClick={run} disabled={testing}>
            {testing ? <Loader2 size={14} className="spin" /> : null}
            {t('kbPage.search')}
          </button>
        </div>

        {result ? (
          result.results?.length || result.nodes?.length ? (
            <div className="search-results">
              {result.kind === 'graph' ? (
                <>
                  <div className="result-chips">
                    {(result.nodes ?? []).map((node) => (
                      <span key={node.name} className="node-chip" title={node.description}>
                        {node.name}
                        {node.type ? <em>{node.type}</em> : null}
                      </span>
                    ))}
                  </div>
                  {(result.edges ?? []).slice(0, 12).map((edge) => (
                    <div key={edge.id} className="result-line">
                      <b>{edge.source}</b>
                      <span className="predicate">{edge.predicate}</span>
                      <b>{edge.target}</b>
                    </div>
                  ))}
                </>
              ) : (
                result.results.map((item, index) => (
                  <div key={`${item.id}-${index}`} className="result-card">
                    <div className="result-score">
                      {item.score?.toFixed(3)}
                      <span>#{index + 1}</span>
                    </div>
                    <div className="result-body">
                      <p>{item.text}</p>
                      <div className="result-meta">
                        {item.file_name}
                        {item.page_start ? t('inv.page', { n: item.page_start }) : ''}
                        {item.section ? ` · ${item.section}` : ''}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <EmptyState
              icon={<Search size={22} />}
              title={t('inv.noHit')}
              hint={result.note || t('inv.noHitHint')}
            />
          )
        ) : null}
      </section>
    </Modal>
  )
}
