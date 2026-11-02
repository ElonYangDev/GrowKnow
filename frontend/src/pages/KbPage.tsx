import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  Code2,
  Download,
  FilePlus2,
  FileText,
  FolderCog,
  Layers,
  Loader2,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Waypoints,
  X,
} from 'lucide-react'
import { api, ApiError } from '../api'
import { statusLabel, useI18n } from '../i18n'
import { useApp, formatSize, formatTime } from '../store'
import type { Kb, KbContent, KbFile, SearchResponse, Skill, Triple } from '../types'
import GraphView from '../components/GraphView'
import FileManagerModal from '../components/FileManagerModal'
import InvocationModal from '../components/InvocationModal'
import KbSettingsModal from '../components/KbSettingsModal'
import UploadModal from '../components/UploadModal'
import { ConfirmDialog, EmptyState, FileProgress, KindBadge, Spinner, StatusChip } from '../components/ui'

const PAGE_SIZE = 20

export default function KbPage() {
  const { kbKey = '' } = useParams()
  const navigate = useNavigate()
  const { notify, refreshKbs } = useApp()
  const { t, lang } = useI18n()

  const [kb, setKb] = useState<Kb | null>(null)
  const [files, setFiles] = useState<KbFile[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [content, setContent] = useState<KbContent | null>(null)
  const [contentLoading, setContentLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<number[]>([])
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [search, setSearch] = useState<SearchResponse | null>(null)
  const [expanded, setExpanded] = useState<number[]>([])

  const [fileManagerOpen, setFileManagerOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [invocationOpen, setInvocationOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [canceling, setCanceling] = useState<number | null>(null)

  const selectedKey = selected.join(',')
  const signature = files.map((file) => `${file.id}:${file.status}:${file.knowledge_count}`).join('|')
  const pending = files.some((file) => file.status === 'queued' || file.status === 'extracting')

  const loadKb = useCallback(async () => {
    try {
      const data = await api.getKb(kbKey)
      setKb(data)
      setLoadError('')
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : t('kbPage.loadFailed'))
    }
  }, [kbKey, t])

  const loadFiles = useCallback(async () => {
    try {
      const list = await api.listFiles(kbKey)
      setFiles(list)
    } catch (error) {
      if (error instanceof ApiError && error.status !== 0) {
        notify(error.message, 'error')
      }
    }
  }, [kbKey, notify])

  useEffect(() => {
    setLoading(true)
    setSelected([])
    setSearch(null)
    setPage(1)
    Promise.all([loadKb(), loadFiles(), api.listSkills().then(setSkills).catch(() => setSkills([]))])
      .finally(() => setLoading(false))
  }, [kbKey, loadKb, loadFiles])

  // 有文件在抽取时轮询文件列表
  useEffect(() => {
    if (!pending) return
    const timer = window.setInterval(() => {
      void loadFiles()
      void loadKb()
    }, 3000)
    return () => window.clearInterval(timer)
  }, [pending, loadFiles, loadKb])

  // 文件就绪情况变化后刷新知识内容
  useEffect(() => {
    if (!kb || search) return
    let cancelled = false
    setContentLoading(true)
    api
      .content(kbKey, { page, size: PAGE_SIZE, fileIds: selected })
      .then((data) => {
        if (!cancelled) setContent(data)
      })
      .catch((error) => {
        if (!cancelled && error instanceof ApiError) notify(error.message, 'error')
      })
      .finally(() => {
        if (!cancelled) setContentLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kbKey, kb?.kind, page, selectedKey, signature, Boolean(search)])

  const runSearch = async () => {
    if (!query.trim()) return
    setSearching(true)
    try {
      const data = await api.search(kbKey, {
        query: query.trim(),
        top_k: 8,
        file_ids: selected.length ? selected : undefined,
      })
      setSearch(data)
    } catch (error) {
      notify(error instanceof ApiError ? error.message : t('inv.searchFailed'), 'error')
    } finally {
      setSearching(false)
    }
  }

  const clearSearch = () => {
    setSearch(null)
    setQuery('')
  }

  const toggleFile = (id: number) => {
    setPage(1)
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  const downloadSelected = () => {
    if (!selected.length) return
    window.open(api.archiveUrl(kbKey, selected), '_blank')
  }

  const cancelFile = async (file: KbFile) => {
    setCanceling(file.id)
    try {
      await api.cancelFile(kbKey, file.id)
      notify(t('fm.cancelSuccess'), 'success')
      await Promise.all([loadFiles(), loadKb()])
    } catch (error) {
      notify(error instanceof ApiError ? error.message : t('fm.cancelFailed'), 'error')
    } finally {
      setCanceling(null)
    }
  }

  const deleteSelected = async () => {
    if (!selected.length) return
    setDeleting(true)
    try {
      await api.deleteFiles(kbKey, selected)
      notify(t('fm.deleteSuccess', { n: selected.length }), 'success')
      setSelected([])
      setDeleteOpen(false)
      await Promise.all([loadFiles(), loadKb(), refreshKbs()])
    } catch (error) {
      notify(error instanceof ApiError ? error.message : t('fm.deleteFailed'), 'error')
    } finally {
      setDeleting(false)
    }
  }

  const toggleExpand = (id: number) => {
    setExpanded((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  const totals = useMemo(() => {
    const ready = files.filter((file) => file.status === 'ready').length
    const knowledge = files.reduce((sum, file) => sum + file.knowledge_count, 0)
    return { ready, knowledge }
  }, [files])

  if (loading) {
    return (
      <div className="page">
        <Spinner label={t('kbPage.reading')} />
      </div>
    )
  }

  if (!kb || loadError) {
    return (
      <div className="page">
        <EmptyState
          icon={<AlertTriangle size={24} />}
          title={t('kbPage.notOpenTitle')}
          hint={loadError || t('kbPage.notOpenHint')}
          action={
            <Link to="/kb" className="btn btn-primary">
              {t('kbPage.backToList')}
            </Link>
          }
        />
      </div>
    )
  }

  const totalPages =
    content && 'total' in content ? Math.max(1, Math.ceil(content.total / PAGE_SIZE)) : 1
  const KindIcon = kb.kind === 'vector' ? BookOpen : kb.kind === 'triple' ? Layers : Waypoints

  return (
    <div className="page kb-page">
      <header className="kb-head">
        <div className="kb-head-main">
          <div className="kb-head-tags">
            <KindBadge kind={kb.kind} />
            <code className="kb-id">{kb.kb_key}</code>
          </div>
          <h1 className="kb-title">{kb.name}</h1>
          <p className="kb-desc">{kb.description || t('kbPage.noDesc')}</p>
          <div className="kb-metrics">
            <span>
              <b>{files.length}</b> {t('kbPage.filesUnit', { n: files.length })}
            </span>
            <span>
              <b>{totals.knowledge.toLocaleString()}</b>{' '}
              {t('kbPage.knowledgeUnit', { n: totals.knowledge })}
            </span>
            {kb.kind === 'graph' && kb.graph_stats ? (
              <span>
                <b>{kb.graph_stats.nodes}</b> {t('kbPage.entitiesUnit', { n: kb.graph_stats.nodes })}{' '}
                · <b>{kb.graph_stats.edges}</b>{' '}
                {t('kbPage.relationsUnit', { n: kb.graph_stats.edges })}
              </span>
            ) : null}
            {pending ? (
              <span className="metric-running">
                <Loader2 size={12} className="spin" /> {t('kbPage.extracting')}
              </span>
            ) : null}
            <span className="metric-muted">
              {t('kbPage.updated', { time: formatTime(kb.updated_at) })}
            </span>
          </div>
        </div>
        <div className="kb-head-actions">
          <button className="btn btn-ghost" onClick={() => setSettingsOpen(true)}>
            <Settings2 size={15} />
            {t('kbPage.manage')}
          </button>
          <button className="btn btn-ghost" onClick={() => setFileManagerOpen(true)}>
            <FolderCog size={15} />
            {t('kbPage.fileManager')}
          </button>
          <button className="btn btn-primary" onClick={() => setInvocationOpen(true)}>
            <Code2 size={15} />
            {t('kbPage.invocation')}
          </button>
        </div>
      </header>

      <div className="kb-body">
        <aside className="file-rail">
          <div className="rail-head">
            <div>
              <h2>{t('kbPage.filesHeading')}</h2>
              <span>{t('kbPage.filesSubtitle', { n: files.length })}</span>
            </div>
            <div className="rail-actions">
              <button
                className="icon-btn"
                onClick={downloadSelected}
                disabled={!selected.length}
                title={t('kbPage.downloadSelected')}
              >
                <Download size={16} />
              </button>
              <button
                className="icon-btn danger"
                onClick={() => setDeleteOpen(true)}
                disabled={!selected.length}
                title={t('kbPage.deleteSelected')}
              >
                <Trash2 size={16} />
              </button>
              <button
                className="icon-btn"
                onClick={() => setUploadOpen(true)}
                title={t('kbPage.addFile')}
              >
                <FilePlus2 size={16} />
              </button>
            </div>
          </div>
          {selected.length ? (
            <button className="rail-filter" onClick={() => setSelected([])}>
              <span>{t('kbPage.selectedOnly', { n: selected.length })}</span>
              <X size={13} />
            </button>
          ) : null}
          <div className="rail-list">
            {files.length === 0 ? (
              <div className="rail-empty">
                <FileText size={20} />
                <p>{t('kbPage.noFiles')}</p>
                <button className="btn btn-soft btn-sm" onClick={() => setUploadOpen(true)}>
                  {t('kbPage.uploadFile')}
                </button>
              </div>
            ) : (
              files.map((file) => (
                <div
                  key={file.id}
                  className={`rail-item ${selected.includes(file.id) ? 'selected' : ''}`}
                  onClick={() => toggleFile(file.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') toggleFile(file.id)
                  }}
                >
                  <span className={`rail-check ${selected.includes(file.id) ? 'on' : ''}`}>
                    {selected.includes(file.id) ? '✓' : ''}
                  </span>
                  <div className="rail-item-body">
                    <div className="rail-name" title={file.name}>
                      {file.name}
                    </div>
                    <div className="rail-meta">
                      <StatusChip status={file.status} label={statusLabel(file.status, lang)} />
                      {file.status === 'queued' || file.status === 'extracting' ? null : (
                        <span className="rail-time">{formatTime(file.status_at)}</span>
                      )}
                    </div>
                    <FileProgress file={file} />
                    <div className="rail-sub">
                      {formatSize(file.size)} · {t('kbPage.knowledgeCount', { n: file.knowledge_count })}
                      {file.status === 'failed' && file.error ? (
                        <span className="rail-error" title={file.error}>
                          {' '}
                          · {t('common.failed')}
                        </span>
                      ) : null}
                    </div>
                    <div className="rail-sub rail-uploaded">
                      {t('kbPage.uploadedAt', { time: formatTime(file.created_at) })}
                    </div>
                  </div>
                  <div className="rail-side">
                    {file.status === 'queued' || file.status === 'extracting' ? (
                      <button
                        className="rail-download rail-cancel"
                        onClick={(event) => {
                          event.stopPropagation()
                          void cancelFile(file)
                        }}
                        title={t('kbPage.cancelExtraction')}
                        disabled={canceling === file.id || file.stage === '取消中…'}
                      >
                        {canceling === file.id || file.stage === '取消中…' ? (
                          <Loader2 size={14} className="spin" />
                        ) : (
                          <CircleStop size={14} />
                        )}
                      </button>
                    ) : null}
                    <a
                      className="rail-download"
                      href={api.downloadUrl(kb.kb_key, file.id)}
                      onClick={(event) => event.stopPropagation()}
                      title={t('kbPage.downloadOriginal')}
                    >
                      <Download size={14} />
                    </a>
                  </div>
                </div>
              ))
            )}
          </div>
          {files.length > 0 ? (
            <button className="rail-foot" onClick={() => setFileManagerOpen(true)}>
              {t('kbPage.openFileManager')}
              <ChevronRight size={14} />
            </button>
          ) : null}
        </aside>

        <section className="knowledge-panel">
          <div className="panel-toolbar">
            <div className="panel-title">
              <span className="panel-icon">
                <KindIcon size={16} />
              </span>
              <div>
                <h2>
                  {kb.kind === 'vector'
                    ? t('kbPage.panelVector')
                    : kb.kind === 'triple'
                      ? t('kbPage.panelTriple')
                      : t('kbPage.panelGraph')}
                </h2>
                <p>
                  {search
                    ? t('kbPage.searchSummary', {
                        query: search.query,
                        n: search.results?.length ?? search.nodes?.length ?? 0,
                      })
                    : content && 'total' in content
                      ? t('kbPage.total', { n: content.total.toLocaleString() })
                      : kb.kind === 'graph' && content
                        ? t('kbPage.graphSummary', {
                            nodes: content.nodes.length,
                            edges: content.edges.length,
                          })
                        : t('kbPage.awaiting')}
                </p>
              </div>
            </div>
            <div className="panel-actions">
              <div className="mini-search">
                <Search size={15} />
                <input
                  placeholder={
                    kb.kind === 'graph'
                      ? t('kbPage.searchGraph')
                      : kb.kind === 'triple'
                        ? t('kbPage.searchTriple')
                        : t('kbPage.searchVector')
                  }
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void runSearch()
                  }}
                />
                {query ? (
                  <button className="mini-clear" onClick={clearSearch} aria-label={t('common.clear')}>
                    <X size={13} />
                  </button>
                ) : null}
              </div>
              <button className="btn btn-soft btn-sm" onClick={runSearch} disabled={searching || !query.trim()}>
                {searching ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
                {t('kbPage.search')}
              </button>
              <button
                className="icon-btn"
                onClick={() => {
                  void loadFiles()
                  void loadKb()
                }}
                title={t('common.refresh')}
              >
                <RefreshCw size={15} />
              </button>
            </div>
          </div>

          <div className="panel-body">
            {files.length === 0 ? (
              <EmptyState
                icon={<FilePlus2 size={26} />}
                title={t('kbPage.emptyUploadTitle')}
                hint={t('kbPage.emptyUploadHint')}
                action={
                  <button className="btn btn-primary" onClick={() => setUploadOpen(true)}>
                    <FilePlus2 size={16} />
                    {t('kbPage.emptyUploadAction')}
                  </button>
                }
              />
            ) : search ? (
              <SearchResultView
                search={search}
                onClear={clearSearch}
                expanded={expanded}
                onToggle={toggleExpand}
              />
            ) : contentLoading && !content ? (
              <Spinner label={t('kbPage.reading')} />
            ) : !content ? (
              <Spinner label={t('kbPage.reading')} />
            ) : content.kind === 'graph' ? (
              content.nodes.length ? (
                <GraphView nodes={content.nodes} edges={content.edges} truncated={content.truncated} />
              ) : (
                <EmptyState
                  icon={<Waypoints size={24} />}
                  title={pending ? t('kbPage.graphBuilding') : t('kbPage.graphEmpty')}
                  hint={
                    pending ? t('kbPage.graphBuildingHint') : t('kbPage.graphEmptyHint')
                  }
                />
              )
            ) : content.kind === 'vector' ? (
              content.items.length ? (
                <div className="chunk-list">
                  {content.items.map((chunk) => {
                    const isOpen = expanded.includes(chunk.id)
                    const long = chunk.content.length > 320
                    return (
                      <article key={chunk.id} className="chunk-card">
                        <div className="chunk-aside">
                          <span className="chunk-seq">#{String(chunk.seq).padStart(3, '0')}</span>
                          <span className="chunk-page">
                            {chunk.page_start ? `P${chunk.page_start}` : '—'}
                            {chunk.page_end && chunk.page_end !== chunk.page_start
                              ? `–${chunk.page_end}`
                              : ''}
                          </span>
                          {chunk.vectorized === false ? (
                            <span className="chunk-warn" title={t('kbPage.notVectorizedHint')}>
                              {t('kbPage.notVectorized')}
                            </span>
                          ) : null}
                        </div>
                        <div className="chunk-main">
                          {chunk.section ? <div className="chunk-section">{chunk.section}</div> : null}
                          <p className={`chunk-text ${!isOpen && long ? 'clamped' : ''}`}>{chunk.content}</p>
                          {long ? (
                            <button className="text-btn" onClick={() => toggleExpand(chunk.id)}>
                              {isOpen ? t('kbPage.collapse') : t('kbPage.expand')}
                            </button>
                          ) : null}
                          <div className="chunk-meta">
                            <FileText size={12} />
                            {chunk.file_name}
                            <span>{t('kbPage.storedAt', { time: formatTime(chunk.created_at) })}</span>
                          </div>
                        </div>
                      </article>
                    )
                  })}
                </div>
              ) : (
                <EmptyState
                  icon={<BookOpen size={24} />}
                  title={pending ? t('kbPage.chunksBuilding') : t('kbPage.chunksEmpty')}
                  hint={pending ? t('kbPage.chunksBuildingHint') : t('kbPage.chunksEmptyHint')}
                />
              )
            ) : content.items.length ? (
              <div className="triple-list">
                {content.items.map((triple) => (
                  <TripleCard key={triple.id} triple={triple} />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<Layers size={24} />}
                title={pending ? t('kbPage.triplesBuilding') : t('kbPage.triplesEmpty')}
                hint={pending ? t('kbPage.triplesBuildingHint') : t('kbPage.triplesEmptyHint')}
              />
            )}
          </div>

          {!search && content && 'total' in content && totalPages > 1 ? (
            <div className="pager">
              <button
                className="btn btn-ghost btn-sm"
                disabled={page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                <ChevronLeft size={14} /> {t('kbPage.prev')}
              </button>
              <span>{t('kbPage.pageOf', { page, total: totalPages })}</span>
              <button
                className="btn btn-ghost btn-sm"
                disabled={page >= totalPages}
                onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
              >
                {t('kbPage.next')} <ChevronRight size={14} />
              </button>
            </div>
          ) : null}
        </section>
      </div>

      <UploadModal
        open={uploadOpen}
        kb={kb}
        skills={skills}
        onClose={() => setUploadOpen(false)}
        onUploaded={() => {
          void loadFiles()
          void loadKb()
          void refreshKbs()
        }}
      />
      <FileManagerModal
        open={fileManagerOpen}
        kb={kb}
        files={files}
        refreshFiles={async () => {
          await loadFiles()
          await loadKb()
          await refreshKbs()
        }}
        onClose={() => setFileManagerOpen(false)}
        onOpenUpload={() => {
          setFileManagerOpen(false)
          setUploadOpen(true)
        }}
      />
      <KbSettingsModal
        open={settingsOpen}
        kb={kb}
        onClose={() => setSettingsOpen(false)}
        onSaved={(updated) => {
          setKb(updated)
          void refreshKbs()
          if (updated.kb_key !== kb.kb_key) {
            navigate(`/kb/${updated.kb_key}`, { replace: true })
          }
        }}
        onDeleted={() => navigate('/kb', { replace: true })}
      />
      <InvocationModal open={invocationOpen} kb={kb} onClose={() => setInvocationOpen(false)} />
      <ConfirmDialog
        open={deleteOpen}
        title={t('kbPage.deleteTitle')}
        busy={deleting}
        message={
          <>
            {t('kbPage.deleteMessagePrefix')}
            <b>{selected.length}</b>
            {t('kbPage.deleteMessageMiddle')}
          </>
        }
        onClose={() => setDeleteOpen(false)}
        onConfirm={deleteSelected}
      />
    </div>
  )
}

function TripleCard({ triple }: { triple: Triple }) {
  const { t } = useI18n()
  return (
    <article className="triple-card">
      <div className="triple-line">
        <span className="triple-term subject">
          {triple.subject}
          {triple.subject_type ? <em>{triple.subject_type}</em> : null}
        </span>
        <span className="triple-predicate">{triple.predicate}</span>
        <span className="triple-term object">
          {triple.object}
          {triple.object_type ? <em>{triple.object_type}</em> : null}
        </span>
      </div>
      {triple.evidence ? <blockquote className="triple-evidence">{triple.evidence}</blockquote> : null}
      <div className="triple-meta">
        <FileText size={12} />
        {triple.file_name}
        {triple.page_start ? <span>{t('kbPage.page', { page: triple.page_start })}</span> : null}
      </div>
    </article>
  )
}

function SearchResultView({
  search,
  onClear,
  expanded,
  onToggle,
}: {
  search: SearchResponse
  onClear: () => void
  expanded: number[]
  onToggle: (id: number) => void
}) {
  const { t } = useI18n()
  if (search.kind === 'graph') {
    const nodes = search.nodes ?? []
    const edges = search.edges ?? []
    if (!nodes.length) {
      return (
        <EmptyState
          icon={<Search size={24} />}
          title={t('kbPage.searchGraphEmpty')}
          hint={t('kbPage.searchGraphEmptyHint')}
          action={
            <button className="btn btn-ghost" onClick={onClear}>
              {t('kbPage.clearSearch')}
            </button>
          }
        />
      )
    }
    return (
      <div className="graph-search">
        <div className="search-banner">
          <span>
            <Sparkles size={14} /> {t('kbPage.hitEntities', { n: search.results.length })}
          </span>
          <button className="text-btn" onClick={onClear}>
            {t('kbPage.exitSearch')}
          </button>
        </div>
        <GraphView nodes={nodes} edges={edges} />
      </div>
    )
  }

  if (!search.results.length) {
    return (
      <EmptyState
        icon={<Search size={24} />}
        title={t('kbPage.noHit')}
        hint={search.note || t('kbPage.noHitHint')}
        action={
          <button className="btn btn-ghost" onClick={onClear}>
            {t('kbPage.backToBrowse')}
          </button>
        }
      />
    )
  }

  if (search.kind === 'triple') {
    return (
      <div className="search-head">
        <div className="search-banner">
          <span>
            <Sparkles size={14} />{' '}
            {t('kbPage.tripleHits', {
              n: search.results.length,
              mode: search.mode === 'keyword' ? t('kbPage.modeKeyword') : t('kbPage.modeHybrid'),
            })}
          </span>
          <button className="text-btn" onClick={onClear}>
            {t('kbPage.backToBrowse')}
          </button>
        </div>
        <div className="triple-list">
          {search.results.map((item, index) => (
            <article className="triple-card" key={`${item.id}-${index}`}>
              <div className="triple-line">
                <span className="triple-term subject">{item.subject}</span>
                <span className="triple-predicate">{item.predicate}</span>
                <span className="triple-term object">{item.object}</span>
                <span className="result-score-inline">{item.score?.toFixed(2)}</span>
              </div>
              {item.evidence ? <blockquote className="triple-evidence">{item.evidence}</blockquote> : null}
              <div className="triple-meta">
                <FileText size={12} />
                {item.file_name}
                {item.page_start ? <span>{t('kbPage.page', { page: item.page_start })}</span> : null}
              </div>
            </article>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="search-head">
      <div className="search-banner">
        <span>
          <Sparkles size={14} />{' '}
          {t('kbPage.chunkHits', {
            n: search.results.length,
            mode:
              search.mode === 'vector'
                ? t('kbPage.modeVector')
                : search.mode === 'mixed'
                  ? t('kbPage.modeMixed')
                  : t('kbPage.modeFallback'),
          })}
          {search.note ? `（${search.note}）` : ''}
        </span>
        <button className="text-btn" onClick={onClear}>
          {t('kbPage.backToBrowse')}
        </button>
      </div>
      <div className="chunk-list">
        {search.results.map((item, index) => {
          const id = Number(item.id ?? index)
          const open = expanded.includes(id)
          const text = item.text ?? ''
          const long = text.length > 320
          return (
            <article key={`${item.id}-${index}`} className="chunk-card search-hit">
              <div className="chunk-aside">
                <span className="chunk-seq">#{index + 1}</span>
                <span className="chunk-page">{item.page_start ? `P${item.page_start}` : '—'}</span>
                <span className="chunk-score">{item.score?.toFixed(3)}</span>
              </div>
              <div className="chunk-main">
                {item.section ? <div className="chunk-section">{item.section}</div> : null}
                <p className={`chunk-text ${!open && long ? 'clamped' : ''}`}>{text}</p>
                {long ? (
                  <button className="text-btn" onClick={() => onToggle(id)}>
                    {open ? t('kbPage.collapse') : t('kbPage.expand')}
                  </button>
                ) : null}
                <div className="chunk-meta">
                  <FileText size={12} />
                  {item.file_name}
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
