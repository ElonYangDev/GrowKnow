import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, BookOpen, Check, Layers, Loader2, Waypoints } from 'lucide-react'
import { api } from '../api'
import { useI18n, type TKey } from '../i18n'
import { useApp, useAsyncAction } from '../store'
import type { KbKind } from '../types'

const KINDS: Array<{
  kind: KbKind
  title: TKey
  icon: typeof BookOpen
  tagline: TKey
  pros: TKey
  cons: TKey
}> = [
  {
    kind: 'vector',
    title: 'newKb.vectorTitle',
    icon: BookOpen,
    tagline: 'newKb.vectorTagline',
    pros: 'newKb.vectorPros',
    cons: 'newKb.vectorCons',
  },
  {
    kind: 'triple',
    title: 'newKb.tripleTitle',
    icon: Layers,
    tagline: 'newKb.tripleTagline',
    pros: 'newKb.triplePros',
    cons: 'newKb.tripleCons',
  },
  {
    kind: 'graph',
    title: 'newKb.graphTitle',
    icon: Waypoints,
    tagline: 'newKb.graphTagline',
    pros: 'newKb.graphPros',
    cons: 'newKb.graphCons',
  },
]

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

export default function NewKbPage() {
  const navigate = useNavigate()
  const { refreshKbs } = useApp()
  const { t } = useI18n()
  const { busy, run } = useAsyncAction()
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [description, setDescription] = useState('')
  const [kind, setKind] = useState<KbKind>('vector')
  const [error, setError] = useState('')

  const autoKey = useMemo(() => slugify(name), [name])

  useEffect(() => {
    if (!keyTouched) setKey(autoKey)
  }, [autoKey, keyTouched])

  const keyValid = /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/.test(key)

  const submit = async () => {
    setError('')
    if (!name.trim()) {
      setError(t('newKb.nameRequired'))
      return
    }
    if (!keyValid) {
      setError(t('newKb.idInvalid'))
      return
    }
    const created = await run(
      () =>
        api.createKb({
          name: name.trim(),
          kb_key: key.trim(),
          description: description.trim(),
          kind,
        }),
      t('newKb.created'),
    )
    if (created) {
      await refreshKbs()
      navigate(`/kb/${created.kb_key}`, { replace: true })
    }
  }

  return (
    <div className="page page-narrow">
      <button className="back-link" onClick={() => navigate(-1)}>
        <ArrowLeft size={15} /> {t('newKb.back')}
      </button>
      <header className="page-head">
        <div>
          <p className="eyebrow">New knowledge base</p>
          <h1 className="page-title">{t('newKb.title')}</h1>
          <p className="page-desc">{t('newKb.desc')}</p>
        </div>
      </header>

      <div className="panel form-panel">
        <div className="form-grid">
          <label className="field">
            <span className="field-label">
              {t('newKb.name')} <em>{t('newKb.editableAfterCreate')}</em>
            </span>
            <input
              className="input"
              value={name}
              maxLength={60}
              placeholder={t('newKb.namePlaceholder')}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
            <span className="field-hint">
              {t('newKb.nameHelp')}
              <code>/api/v1/kb/{key || 'your-id'}/search</code>
            </span>
          </label>
          <label className="field">
            <span className="field-label">
              {t('newKb.id')} <em>{t('newKb.editableAfterCreate')}</em>
            </span>
            <input
              className={`input mono ${key && !keyValid ? 'input-invalid' : ''}`}
              value={key}
              placeholder="lab-operating-manual"
              onChange={(event) => {
                setKeyTouched(true)
                setKey(event.target.value)
              }}
            />
            <span className="field-hint">{t('newKb.idHelp')}</span>
          </label>
          <label className="field field-full">
            <span className="field-label">
              {t('newKb.description')} <em>{t('newKb.optionalEditable')}</em>
            </span>
            <textarea
              className="input textarea"
              rows={3}
              maxLength={1000}
              value={description}
              placeholder={t('newKb.descriptionPlaceholder')}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
        </div>

        <div className="field">
          <span className="field-label">
            {t('newKb.kind')} <em>{t('newKb.kindFixed')}</em>
          </span>
          <div className="kind-options">
            {KINDS.map((item) => {
              const Icon = item.icon
              const active = kind === item.kind
              return (
                <button
                  key={item.kind}
                  type="button"
                  className={`kind-option ${active ? 'active' : ''} kind-option-${item.kind}`}
                  onClick={() => setKind(item.kind)}
                >
                  <span className="kind-option-head">
                    <span className="kind-option-icon">
                      <Icon size={18} />
                    </span>
                    <span>
                      <b>{t(item.title)}</b>
                      <small>{t(item.tagline)}</small>
                    </span>
                    {active ? <Check size={16} className="kind-check" /> : null}
                  </span>
                  <span className="kind-pros">{t(item.pros)}</span>
                  <span className="kind-cons">{t(item.cons)}</span>
                </button>
              )
            })}
          </div>
        </div>

        {error ? <p className="form-error">{error}</p> : null}

        <div className="form-actions">
          <button className="btn btn-ghost" onClick={() => navigate(-1)}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? <Loader2 size={16} className="spin" /> : <ArrowRight size={16} />}
            {t('newKb.create')}
          </button>
        </div>
      </div>
    </div>
  )
}
