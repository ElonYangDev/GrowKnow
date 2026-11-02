import { useEffect, useMemo, useState } from 'react'
import { Boxes, Loader2, Plus, Save, Sparkles, Trash2 } from 'lucide-react'
import { api, ApiError } from '../api'
import { skillDisplayName, useI18n, type Lang, type TFunction } from '../i18n'
import { useApp, formatTime } from '../store'
import type { Skill } from '../types'
import { ConfirmDialog, EmptyState, Spinner } from '../components/ui'

type Draft = {
  id: number | null
  slug: string
  name: string
  description: string
  target: 'triple' | 'graph' | 'any'
  content: string
  builtin: boolean
}

const BLANK: Draft = {
  id: null,
  slug: '',
  name: '',
  description: '',
  target: 'triple',
  content: '',
  builtin: false,
}

const TEMPLATE_ZH = `# 抽取目标

说明这个 skill 适用的文档类型，以及抽取时应关注的知识范围。

## 抽取范围
- 应抽取：……
- 不抽取：……

## 质量规范
1. 指代必须消解为文档中的明确名称。
2. 数值保留单位与条件；不确定的内容不输出。
3. 一条事实一条记录，同一片段内不重复。

## 示例
原文：……
输出：……

请严格遵循程序在消息末尾给出的 JSON 输出契约。
`

const TEMPLATE_EN = `# Extraction goal

Describe the document types this skill applies to and the knowledge to focus on.

## Scope
- Extract: ...
- Do not extract: ...

## Quality rules
1. Resolve pronouns to the explicit names used in the document.
2. Keep units and conditions for numeric values; skip anything uncertain.
3. One fact per record; no duplicates within a chunk.

## Example
Source: ...
Output: ...

Follow the JSON output contract appended to the end of the message.
`

function template(lang: Lang): string {
  return lang === 'en' ? TEMPLATE_EN : TEMPLATE_ZH
}

export default function SkillsPage() {
  const { notify, refreshKbs } = useApp()
  const { t, lang } = useI18n()
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState('')

  const load = async (selectId?: number) => {
    setLoading(true)
    try {
      const list = await api.listSkills()
      setSkills(list)
      const target = selectId
        ? list.find((skill) => skill.id === selectId)
        : list.find((skill) => skill.id === draft?.id) ?? list[0]
      if (target) setDraft(strip(target))
    } catch (err) {
      notify(err instanceof ApiError ? err.message : t('skills.loadFailed'), 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const dirty = useMemo(() => {
    if (!draft) return false
    if (draft.id === null) return Boolean(draft.name || draft.slug || draft.content)
    const original = skills.find((skill) => skill.id === draft.id)
    if (!original) return true
    return (
      original.name !== draft.name ||
      original.slug !== draft.slug ||
      original.description !== draft.description ||
      original.target !== draft.target ||
      original.content !== draft.content
    )
  }, [draft, skills])

  const save = async () => {
    if (!draft) return
    setError('')
    if (!draft.name.trim() || !draft.slug.trim() || !draft.content.trim()) {
      setError(t('skills.errorEmpty'))
      return
    }
    setSaving(true)
    try {
      const body = {
        name: draft.name.trim(),
        slug: draft.slug.trim(),
        description: draft.description.trim(),
        target: draft.target,
        content: draft.content,
      }
      const saved =
        draft.id === null
          ? await api.createSkill(body)
          : await api.updateSkill(draft.id, body)
      notify(draft.id === null ? t('skills.created') : t('skills.saved'), 'success')
      await load(saved.id)
      await refreshKbs()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('skills.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!draft?.id) return
    setDeleting(true)
    try {
      await api.deleteSkill(draft.id)
      notify(t('skills.deleted'), 'success')
      setConfirm(false)
      setDraft(null)
      await load()
    } catch (err) {
      notify(err instanceof ApiError ? err.message : t('skills.deleteFailed'), 'error')
      setDeleting(false)
      setConfirm(false)
    }
  }

  if (loading && !skills.length) {
    return (
      <div className="page">
        <Spinner label={t('skills.loading')} />
      </div>
    )
  }

  return (
    <div className="page skills-page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Extraction skills</p>
          <h1 className="page-title">{t('skills.title')}</h1>
          <p className="page-desc">{t('skills.desc')}</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => {
            setError('')
            setDraft({ ...BLANK, content: template(lang) })
          }}
        >
          <Plus size={16} />
          {t('skills.new')}
        </button>
      </header>

      <div className="skills-layout">
        <aside className="skill-list panel">
          {skills.length === 0 ? (
            <p className="skill-list-empty">{t('skills.emptyList')}</p>
          ) : (
            skills.map((skill) => (
              <button
                key={skill.id}
                className={`skill-item ${draft?.id === skill.id ? 'active' : ''}`}
                onClick={() => {
                  setError('')
                  setDraft(strip(skill))
                }}
              >
                <div className="skill-item-head">
                  <b>{skillDisplayName(skill, lang)}</b>
                  {skill.builtin ? <span className="tag">{t('skills.builtin')}</span> : null}
                </div>
                <div className="skill-item-sub">
                  <span>{targetLabel(skill.target, t)}</span>
                  {skill.file_count ? <span>{t('skills.filesUsing', { n: skill.file_count })}</span> : null}
                </div>
                <code>{skill.slug}</code>
              </button>
            ))
          )}
        </aside>

        <section className="panel skill-editor">
          {!draft ? (
            <EmptyState
              icon={<Boxes size={24} />}
              title={t('skills.selectTitle')}
              hint={t('skills.selectHint')}
            />
          ) : (
            <>
              <div className="editor-head">
                <div>
                  <h2>{draft.id ? t('skills.editTitle') : t('skills.createTitle')}</h2>
                  <p>
                    {draft.id
                      ? t('skills.lastUpdated', {
                          time: formatTime(skills.find((skill) => skill.id === draft.id)?.updated_at),
                        })
                      : t('skills.fillFirst')}
                    {dirty ? <span className="dirty-dot"> · {t('skills.unsaved')}</span> : null}
                  </p>
                </div>
                <div className="editor-actions">
                  {draft.id && !draft.builtin ? (
                    <button className="btn btn-danger-soft btn-sm" onClick={() => setConfirm(true)}>
                      <Trash2 size={14} />
                      {t('common.delete')}
                    </button>
                  ) : null}
                  <button className="btn btn-primary btn-sm" onClick={save} disabled={saving || !dirty}>
                    {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
                    {t('common.save')}
                  </button>
                </div>
              </div>

              <div className="form-grid editor-form">
                <label className="field">
                  <span className="field-label">{t('skills.name')}</span>
                  <input
                    className="input"
                    value={draft.name}
                    placeholder={t('skills.namePlaceholder')}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="field-label">
                    {t('skills.slug')} <em>{t('skills.slugHint')}</em>
                  </span>
                  <input
                    className="input mono"
                    value={draft.slug}
                    placeholder="legal-triple"
                    onChange={(event) => setDraft({ ...draft, slug: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="field-label">{t('skills.target')}</span>
                  <select
                    className="input"
                    value={draft.target}
                    onChange={(event) =>
                      setDraft({ ...draft, target: event.target.value as Draft['target'] })
                    }
                  >
                    <option value="triple">{t('kind.targetTriple')}</option>
                    <option value="graph">{t('kind.targetGraph')}</option>
                    <option value="any">{t('kind.targetAny')}</option>
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">{t('skills.description')}</span>
                  <input
                    className="input"
                    value={draft.description}
                    placeholder={t('skills.descriptionPlaceholder')}
                    onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  />
                </label>
              </div>

              <label className="field content-field">
                <span className="field-label">
                  {t('skills.content')}
                  <em>{t('skills.contentHint')}</em>
                </span>
                <textarea
                  className="input code-input"
                  rows={20}
                  value={draft.content}
                  spellCheck={false}
                  onChange={(event) => setDraft({ ...draft, content: event.target.value })}
                />
                <span className="field-hint">{t('skills.chars', { n: draft.content.length.toLocaleString() })}</span>
              </label>

              {draft.builtin ? (
                <p className="inline-hint">
                  <Sparkles size={14} /> {t('skills.builtinHint')}
                </p>
              ) : null}
              {error ? <p className="form-error">{error}</p> : null}
            </>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={confirm}
        title={t('skills.deleteTitle', { name: draft ? skillDisplayName(draft, lang) : '' })}
        busy={deleting}
        message={t('skills.deleteMessage')}
        onClose={() => setConfirm(false)}
        onConfirm={remove}
      />
    </div>
  )
}

function strip(skill: Skill): Draft {
  return {
    id: skill.id,
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    target: skill.target,
    content: skill.content,
    builtin: skill.builtin,
  }
}

function targetLabel(target: string, t: TFunction): string {
  if (target === 'triple') return t('kind.targetTriple')
  if (target === 'graph') return t('kind.targetGraph')
  return t('kind.targetAny')
}
