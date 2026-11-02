import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, Copy, Info, Loader2, X } from 'lucide-react'
import { formatDuration, kindShortLabel, stageLabel, useI18n } from '../i18n'
import { useApp } from '../store'
import type { FileStatus, KbFile, KbKind } from '../types'

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 720,
  className = '',
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: number
  className?: string
}) {
  const { t } = useI18n()
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="modal-mask" role="presentation" onMouseDown={onClose}>
      <div
        className={`modal ${className}`}
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <div>
            <h2 className="modal-title">{title}</h2>
            {subtitle ? <p className="modal-subtitle">{subtitle}</p> : null}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
            <X size={18} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-foot">{footer}</footer> : null}
      </div>
    </div>
  )
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const { t } = useI18n()
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={460}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-danger" onClick={onConfirm} disabled={busy}>
            {busy ? <Loader2 size={15} className="spin" /> : <AlertTriangle size={15} />}
            {confirmLabel ?? t('common.delete')}
          </button>
        </>
      }
    >
      <div className="confirm-text">{message}</div>
    </Modal>
  )
}

export function ToastStack() {
  const { toasts, dismiss } = useApp()
  const { t } = useI18n()
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`}>
          <span className="toast-icon">
            {toast.kind === 'success' ? (
              <Check size={15} />
            ) : toast.kind === 'error' ? (
              <AlertTriangle size={15} />
            ) : (
              <Info size={15} />
            )}
          </span>
          <span className="toast-text">{toast.message}</span>
          <button className="toast-close" onClick={() => dismiss(toast.id)} aria-label={t('common.close')}>
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="spinner-row">
      <Loader2 size={18} className="spin" />
      {label ? <span>{label}</span> : null}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode
  title: string
  hint?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      {icon ? <div className="empty-icon">{icon}</div> : null}
      <h3>{title}</h3>
      {hint ? <p>{hint}</p> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  )
}

const STATUS_CLASS: Record<FileStatus, string> = {
  queued: 'status-queued',
  extracting: 'status-running',
  ready: 'status-ready',
  failed: 'status-failed',
  canceled: 'status-canceled',
}

export function StatusChip({ status, label }: { status: FileStatus; label: string }) {
  return (
    <span className={`status-chip ${STATUS_CLASS[status] ?? ''}`}>
      <i />
      {label}
    </span>
  )
}

/**
 * 抽取进度：只有排队中 / 抽取中的文件才显示。
 * progress 为 null 表示当前阶段耗时不可预估（例如只有一段切片），
 * 此时展示流动的“不确定进度条”+ 阶段文案 + 已用时间，避免出现假的 0%/100%。
 */
export function FileProgress({ file }: { file: KbFile }) {
  const { t, lang } = useI18n()
  const active = file.status === 'queued' || file.status === 'extracting'
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (file.status !== 'extracting') return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [file.status, file.status_at])

  if (!active) return null

  const queued = file.status === 'queued'
  const determinate = !queued && typeof file.progress === 'number'
  const started = new Date(file.status_at).getTime()
  const elapsed = Number.isNaN(started) ? 0 : Math.max(0, Math.round((now - started) / 1000))
  const stage = stageLabel(file.stage, lang) || (queued ? t('progress.queued') : t('progress.extracting'))
  const percent = determinate ? Math.min(100, Math.max(0, file.progress as number)) : null

  return (
    <div className="file-progress">
      <div
        className={`progress-track${percent === null ? ' indeterminate' : ''}`}
        role="progressbar"
        aria-label={stage}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        aria-valuetext={percent === null ? stage : `${percent}%`}
      >
        <span
          className="progress-fill"
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
      <div className="progress-meta">
        <span className="progress-stage">{stage}</span>
        <span className="progress-caption">
          {queued
            ? t('progress.waiting')
            : percent === null
              ? t('progress.elapsed', { time: formatDuration(elapsed, lang) })
              : `${percent}%`}
        </span>
      </div>
    </div>
  )
}


const KIND_GLYPH: Record<KbKind, string> = {
  vector: 'V',
  triple: 'T',
  graph: 'G',
}

export function KindBadge({ kind, text }: { kind: KbKind; text?: string }) {
  const { lang } = useI18n()
  return (
    <span className={`kind-badge kind-${kind}`}>
      <i>{KIND_GLYPH[kind]}</i>
      {text ?? kindShortLabel(kind, lang)}
    </span>
  )
}

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const { notify } = useApp()
  const { t } = useI18n()
  return (
    <button
      className="btn btn-ghost btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          notify(t('common.copied'), 'success')
        } catch {
          notify(t('common.copyFailed'), 'error')
        }
      }}
    >
      <Copy size={14} />
      {label ?? t('common.copy')}
    </button>
  )
}
