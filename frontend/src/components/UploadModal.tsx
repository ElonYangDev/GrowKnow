import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Loader2, Trash2, UploadCloud, Wand2 } from 'lucide-react'
import { api, ApiError } from '../api'
import { skillDisplayName, useI18n } from '../i18n'
import { useApp, formatSize } from '../store'
import type { Kb, Skill } from '../types'
import { Modal } from './ui'

const ACCEPT = '.pdf,.doc,.docx'

export default function UploadModal({
  open,
  kb,
  skills,
  onClose,
  onUploaded,
}: {
  open: boolean
  kb: Kb
  skills: Skill[]
  onClose: () => void
  onUploaded: () => void
}) {
  const { notify } = useApp()
  const { t, lang } = useI18n()
  const [files, setFiles] = useState<File[]>([])
  const [pages, setPages] = useState(5)
  const [skillId, setSkillId] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const candidates = useMemo(
    () => skills.filter((skill) => skill.target === 'any' || skill.target === kb.kind),
    [skills, kb.kind],
  )

  useEffect(() => {
    if (!open) return
    setFiles([])
    setPages(5)
    setError('')
    setSubmitting(false)
    const preferred = candidates.find((skill) =>
      kb.kind === 'graph' ? skill.slug === 'generic-graph' : skill.slug === 'generic-triple',
    )
    setSkillId(preferred?.id ?? candidates[0]?.id ?? null)
  }, [open, candidates, kb.kind])

  const addFiles = (incoming: FileList | File[]) => {
    const accepted: File[] = []
    const rejected: string[] = []
    for (const file of Array.from(incoming)) {
      const suffix = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
      if (!ACCEPT.split(',').includes(suffix)) {
        rejected.push(file.name)
        continue
      }
      if (file.size > 100 * 1024 * 1024) {
        rejected.push(t('upload.overSize', { name: file.name }))
        continue
      }
      accepted.push(file)
    }
    if (rejected.length) setError(t('upload.skipUnsupported', { names: rejected.join(', ') }))
    setFiles((current) => {
      const names = new Set(current.map((file) => `${file.name}:${file.size}`))
      return [...current, ...accepted.filter((file) => !names.has(`${file.name}:${file.size}`))]
    })
  }

  const submit = async () => {
    if (!files.length) {
      setError(t('upload.chooseFirst'))
      return
    }
    if (kb.kind !== 'vector' && !skillId) {
      setError(t('upload.chooseSkill'))
      return
    }
    const form = new FormData()
    for (const file of files) form.append('files', file)
    form.append('page_slices', String(pages))
    if (kb.kind !== 'vector' && skillId) form.append('skill_id', String(skillId))
    setSubmitting(true)
    setError('')
    try {
      const created = await api.uploadFiles(kb.kb_key, form)
      notify(t('upload.queued', { n: created.length }), 'success')
      onUploaded()
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('upload.failed'))
    } finally {
      setSubmitting(false)
    }
  }

  const totalSize = files.reduce((sum, file) => sum + file.size, 0)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('upload.title')}
      subtitle={t('upload.subtitle', { name: kb.name })}
      width={680}
      footer={
        <>
          <span className="foot-note">
            {files.length
              ? t('upload.filesSelected', { n: files.length, size: formatSize(totalSize) })
              : t('upload.supports')}
          </span>
          <button className="btn btn-ghost" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={submitting || !files.length}>
            {submitting ? <Loader2 size={16} className="spin" /> : <Wand2 size={16} />}
            {t('upload.start')}
          </button>
        </>
      }
    >
      <div
        className={`dropzone ${dragging ? 'dragging' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files)
        }}
        onClick={() => inputRef.current?.click()}
      >
        <UploadCloud size={26} />
        <b>{t('upload.dropTitle')}</b>
        <span>{t('upload.dropHint')}</span>
        <input
          ref={inputRef}
          type="file"
          hidden
          multiple
          accept={ACCEPT}
          onChange={(event) => {
            if (event.target.files?.length) addFiles(event.target.files)
            event.target.value = ''
          }}
        />
      </div>

      {files.length ? (
        <ul className="upload-list">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`}>
              <FileText size={16} />
              <span className="upload-name">{file.name}</span>
              <span className="upload-size">{formatSize(file.size)}</span>
              <button
                className="icon-btn subtle"
                onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                aria-label={t('common.remove')}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="upload-options">
        <label className="field">
          <span className="field-label">
            {t('upload.pages')}
            <em>{t('upload.pagesHint')}</em>
          </span>
          <div className="stepper">
            <button
              type="button"
              onClick={() => setPages((value) => Math.max(1, value - 1))}
              aria-label={t('upload.decrease')}
            >
              −
            </button>
            <input
              type="number"
              min={1}
              max={200}
              value={pages}
              onChange={(event) =>
                setPages(Math.min(200, Math.max(1, Number(event.target.value) || 1)))
              }
            />
            <button
              type="button"
              onClick={() => setPages((value) => Math.min(200, value + 1))}
              aria-label={t('upload.increase')}
            >
              +
            </button>
          </div>
        </label>
        {kb.kind === 'vector' ? (
          <div className="field">
            <span className="field-label">{t('upload.skill')}</span>
            <p className="field-hint">{t('upload.vectorHint')}</p>
          </div>
        ) : (
          <label className="field">
            <span className="field-label">
              {t('upload.skill')} <em>{t('upload.skillHint')}</em>
            </span>
            <select
              className="input"
              value={skillId ?? ''}
              onChange={(event) => setSkillId(Number(event.target.value) || null)}
            >
              {candidates.map((skill) => (
                <option key={skill.id} value={skill.id}>
                  {skillDisplayName(skill, lang)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {error ? <p className="form-error">{error}</p> : null}
    </Modal>
  )
}
