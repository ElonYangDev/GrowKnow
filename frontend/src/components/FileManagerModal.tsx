import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  CircleStop,
  Download,
  FilePlus2,
  Loader2,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { api, ApiError } from '../api'
import { statusLabel, useI18n } from '../i18n'
import { useApp, formatSize, formatTime } from '../store'
import type { Kb, KbFile } from '../types'
import { ConfirmDialog, EmptyState, FileProgress, Modal, StatusChip } from './ui'

export default function FileManagerModal({
  open,
  kb,
  files,
  refreshFiles,
  onClose,
  onOpenUpload,
}: {
  open: boolean
  kb: Kb
  files: KbFile[]
  refreshFiles: () => Promise<void> | void
  onClose: () => void
  onOpenUpload: () => void
}) {
  const { notify } = useApp()
  const { t, lang } = useI18n()
  const [selected, setSelected] = useState<number[]>([])
  const [pendingDelete, setPendingDelete] = useState<number[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [retrying, setRetrying] = useState<number | null>(null)
  const [canceling, setCanceling] = useState<number | null>(null)

  useEffect(() => {
    if (open) setSelected([])
  }, [open])

  const toggle = (id: number) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  const allSelected = files.length > 0 && selected.length === files.length

  const remove = async (ids: number[]) => {
    setBusy(true)
    try {
      await api.deleteFiles(kb.kb_key, ids)
      notify(t('fm.deleteSuccess', { n: ids.length }), 'success')
      setSelected([])
      setPendingDelete(null)
      await refreshFiles()
    } catch (error) {
      notify(error instanceof ApiError ? error.message : t('fm.deleteFailed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const retry = async (file: KbFile) => {
    setRetrying(file.id)
    try {
      await api.retryFile(kb.kb_key, file.id)
      notify(t('fm.retrySuccess'), 'success')
      await refreshFiles()
    } catch (error) {
      notify(error instanceof ApiError ? error.message : t('fm.retryFailed'), 'error')
    } finally {
      setRetrying(null)
    }
  }

  const downloadArchive = () => {
    if (!selected.length) return
    window.open(api.archiveUrl(kb.kb_key, selected), '_blank')
  }

  const cancel = async (file: KbFile) => {
    setCanceling(file.id)
    try {
      await api.cancelFile(kb.kb_key, file.id)
      notify(t('fm.cancelSuccess'), 'success')
      await refreshFiles()
    } catch (error) {
      notify(error instanceof ApiError ? error.message : t('fm.cancelFailed'), 'error')
    } finally {
      setCanceling(null)
    }
  }

  const stats = {
    ready: files.filter((file) => file.status === 'ready').length,
    running: files.filter((file) => file.status === 'extracting' || file.status === 'queued').length,
    failed: files.filter((file) => file.status === 'failed').length,
    canceled: files.filter((file) => file.status === 'canceled').length,
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={t('fm.title')}
        subtitle={t('fm.subtitle', {
          name: kb.name,
          n: files.length,
          ready: stats.ready,
          running: stats.running,
          failed: stats.failed,
          canceled: stats.canceled ? t('fm.canceledPart', { n: stats.canceled }) : '',
        })}
        width={960}
        footer={
          <>
            <span className="foot-note">
              {selected.length ? t('fm.selected', { n: selected.length }) : t('fm.deleteNote')}
            </span>
            <button className="btn btn-ghost" onClick={downloadArchive} disabled={!selected.length}>
              <Download size={15} />
              {t('fm.batchDownload')}
            </button>
            <button
              className="btn btn-danger-soft"
              onClick={() => setPendingDelete(selected)}
              disabled={!selected.length}
            >
              <Trash2 size={15} />
              {t('fm.deleteSelected')}
            </button>
            <button className="btn btn-primary" onClick={onOpenUpload}>
              <FilePlus2 size={15} />
              {t('fm.upload')}
            </button>
          </>
        }
      >
        {files.length === 0 ? (
          <EmptyState
            icon={<FilePlus2 size={24} />}
            title={t('fm.emptyTitle')}
            hint={t('fm.emptyHint')}
            action={
              <button className="btn btn-primary" onClick={onOpenUpload}>
                {t('fm.upload')}
              </button>
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="cell-check">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={() =>
                        setSelected(allSelected ? [] : files.map((file) => file.id))
                      }
                      aria-label={t('fm.selectAll')}
                    />
                  </th>
                  <th>{t('fm.fileName')}</th>
                  <th>{t('fm.uploaded')}</th>
                  <th>{t('fm.status')}</th>
                  <th className="cell-num">{t('fm.knowledge')}</th>
                  <th className="cell-actions">{t('fm.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr key={file.id} className={selected.includes(file.id) ? 'selected' : ''}>
                    <td className="cell-check">
                      <input
                        type="checkbox"
                        checked={selected.includes(file.id)}
                        onChange={() => toggle(file.id)}
                        aria-label={t('fm.selectFile', { name: file.name })}
                      />
                    </td>
                    <td>
                      <div className="file-name" title={file.name}>
                        {file.name}
                      </div>
                      <div className="file-meta">
                        {formatSize(file.size)}
                        {file.page_count ? ` · ${t('fm.pages', { n: file.page_count })}` : ''}
                        {file.skill_name ? ` · ${file.skill_name}` : ''}
                      </div>
                      {file.status === 'failed' && file.error ? (
                        <div className="file-error">
                          <AlertTriangle size={12} /> {file.error}
                        </div>
                      ) : null}
                    </td>
                    <td className="cell-date">{formatTime(file.created_at)}</td>
                    <td>
                      <StatusChip status={file.status} label={statusLabel(file.status, lang)} />
                      <FileProgress file={file} />
                      {file.status === 'queued' || file.status === 'extracting' ? null : (
                        <div className="status-time">{formatTime(file.status_at)}</div>
                      )}
                    </td>
                    <td className="cell-num">{file.knowledge_count.toLocaleString()}</td>
                    <td className="cell-actions">
                      <a
                        className="icon-btn"
                        href={api.downloadUrl(kb.kb_key, file.id)}
                        title={t('kbPage.downloadOriginal')}
                      >
                        <Download size={15} />
                      </a>
                      {file.status === 'queued' || file.status === 'extracting' ? (
                        <button
                          className="icon-btn"
                          onClick={() => cancel(file)}
                          title={t('kbPage.cancelExtraction')}
                          disabled={canceling === file.id || file.stage === '取消中…'}
                        >
                          {canceling === file.id || file.stage === '取消中…' ? (
                            <Loader2 size={15} className="spin" />
                          ) : (
                            <CircleStop size={15} />
                          )}
                        </button>
                      ) : null}
                      {file.status === 'failed' || file.status === 'canceled' ? (
                        <button
                          className="icon-btn"
                          onClick={() => retry(file)}
                          title={t('fm.retry')}
                          disabled={retrying === file.id}
                        >
                          {retrying === file.id ? (
                            <Loader2 size={15} className="spin" />
                          ) : (
                            <RefreshCw size={15} />
                          )}
                        </button>
                      ) : null}
                      <button
                        className="icon-btn danger"
                        onClick={() => setPendingDelete([file.id])}
                        title={t('common.delete')}
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingDelete?.length)}
        title={t('fm.deleteTitle')}
        busy={busy}
        message={
          <>
            {t('fm.deleteMessagePrefix')}
            <b>{pendingDelete?.length ?? 0}</b>
            {t('fm.deleteMessageMiddle')}
          </>
        }
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && remove(pendingDelete)}
      />
    </>
  )
}
