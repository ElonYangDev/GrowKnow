import { useEffect, useState } from 'react'
import { Loader2, Save, Trash2 } from 'lucide-react'
import { api, ApiError } from '../api'
import { kindLabel, useI18n } from '../i18n'
import { useApp } from '../store'
import type { Kb } from '../types'
import { ConfirmDialog, Modal } from './ui'

export default function KbSettingsModal({
  open,
  kb,
  onClose,
  onSaved,
  onDeleted,
}: {
  open: boolean
  kb: Kb
  onClose: () => void
  onSaved: (kb: Kb) => void
  onDeleted: () => void
}) {
  const { notify, refreshKbs } = useApp()
  const { t, lang } = useI18n()
  const [name, setName] = useState(kb.name)
  const [key, setKey] = useState(kb.kb_key)
  const [description, setDescription] = useState(kb.description)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setName(kb.name)
    setKey(kb.kb_key)
    setDescription(kb.description)
    setError('')
    setConfirmDelete(false)
  }, [open, kb])

  const save = async () => {
    setError('')
    if (!name.trim()) {
      setError(t('kbSet.nameRequired'))
      return
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/.test(key)) {
      setError(t('kbSet.idInvalid'))
      return
    }
    setBusy(true)
    try {
      const updated = await api.updateKb(kb.kb_key, {
        name: name.trim(),
        kb_key: key.trim(),
        description: description.trim(),
      })
      notify(t('kbSet.updated'), 'success')
      await refreshKbs()
      onSaved(updated)
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('kbSet.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setDeleting(true)
    try {
      await api.deleteKb(kb.kb_key)
      notify(t('kbSet.deleted'), 'success')
      await refreshKbs()
      onDeleted()
    } catch (err) {
      notify(err instanceof ApiError ? err.message : t('kbSet.deleteFailed'), 'error')
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  const keyChanged = key.trim() !== kb.kb_key

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={t('kbSet.title')}
        subtitle={kindLabel(kb.kind, lang)}
        width={620}
        footer={
          <>
            <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
              {t('common.cancel')}
            </button>
            <button className="btn btn-primary" onClick={save} disabled={busy}>
              {busy ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
              {t('common.saveChanges')}
            </button>
          </>
        }
      >
        <div className="form-grid">
          <label className="field">
            <span className="field-label">
              {t('kbSet.name')} <em>{t('kbSet.nameHint')}</em>
            </span>
            <input
              className="input"
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">
              {t('kbSet.id')} <em>{t('kbSet.idHint')}</em>
            </span>
            <input
              className="input mono"
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
          </label>
          <label className="field field-full">
            <span className="field-label">{t('kbSet.description')}</span>
            <textarea
              className="input textarea"
              rows={4}
              maxLength={1000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
        </div>
        {keyChanged ? <p className="inline-warn">{t('kbSet.idWarning')}</p> : null}
        {error ? <p className="form-error">{error}</p> : null}

        <div className="danger-zone">
          <div>
            <b>{t('kbSet.dangerTitle')}</b>
            <p>{t('kbSet.dangerDesc')}</p>
          </div>
          <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={15} />
            {t('kbSet.delete')}
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        title={t('kbSet.confirmTitle', { name: kb.name })}
        busy={deleting}
        message={
          <>
            {t('kbSet.confirmPrefix')}
            <b>{kb.file_count}</b>
            {t('kbSet.confirmMiddle')}
            <b>{kb.knowledge_count}</b>
            {t('kbSet.confirmSuffix')}
          </>
        }
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
      />
    </>
  )
}
