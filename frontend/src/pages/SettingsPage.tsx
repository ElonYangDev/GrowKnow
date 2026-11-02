import { useEffect, useState } from 'react'
import {
  Activity,
  CheckCircle2,
  Cpu,
  Database,
  Eye,
  EyeOff,
  Languages,
  Loader2,
  PlugZap,
  Save,
  Server,
  Sparkles,
  XCircle,
} from 'lucide-react'
import { api, ApiError } from '../api'
import { useI18n, type LangPref } from '../i18n'
import { useApp } from '../store'
import type { Settings } from '../types'

type KeyState = { value: string; clear: boolean }

const EMPTY_KEY: KeyState = { value: '', clear: false }

const LANG_OPTIONS: LangPref[] = ['auto', 'zh', 'en']

export default function SettingsPage() {
  const { notify } = useApp()
  const { t, lang, pref, setPref } = useI18n()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [testInfo, setTestInfo] = useState<Record<string, string>>({})
  const [deps, setDeps] = useState<Record<string, { ok: boolean; [key: string]: unknown }> | null>(null)
  const [depsAt, setDepsAt] = useState('')
  const [depsLoading, setDepsLoading] = useState(false)

  const [llm, setLlm] = useState({ base_url: '', model: '' })
  const [emb, setEmb] = useState({ base_url: '', model: '' })
  const [mineru, setMineru] = useState({ mode: 'agent', url: '', tier: 'standard' })
  const [llmKey, setLlmKey] = useState<KeyState>(EMPTY_KEY)
  const [embKey, setEmbKey] = useState<KeyState>(EMPTY_KEY)
  const [mineruKey, setMineruKey] = useState<KeyState>(EMPTY_KEY)
  const [showLlmKey, setShowLlmKey] = useState(false)
  const [showEmbKey, setShowEmbKey] = useState(false)
  const [showMineruKey, setShowMineruKey] = useState(false)

  const apply = (data: Settings) => {
    setSettings(data)
    setLlm({ base_url: data.llm.base_url, model: data.llm.model })
    setEmb({ base_url: data.embedding.base_url, model: data.embedding.model })
    setMineru({
      mode: data.mineru.mode || 'agent',
      url: data.mineru.url,
      tier: data.mineru.tier,
    })
    setLlmKey(EMPTY_KEY)
    setEmbKey(EMPTY_KEY)
    setMineruKey(EMPTY_KEY)
  }

  useEffect(() => {
    api
      .settings()
      .then(apply)
      .catch((err) => notify(err instanceof ApiError ? err.message : t('settings.loadFailed'), 'error'))
      .finally(() => setLoading(false))
  }, [notify, t])

  const loadDeps = async () => {
    setDepsLoading(true)
    try {
      const data = await api.healthDeps()
      setDeps(data)
      setDepsAt(new Date().toLocaleTimeString(lang === 'zh' ? 'zh-CN' : 'en-US'))
    } catch (err) {
      notify(err instanceof ApiError ? err.message : t('settings.depsFailed'), 'error')
    } finally {
      setDepsLoading(false)
    }
  }

  useEffect(() => {
    void loadDeps()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      const result = await api.saveSettings({
        llm: {
          base_url: llm.base_url.trim(),
          model: llm.model.trim(),
          api_key: llmKey.clear ? '' : llmKey.value || null,
        },
        embedding: {
          base_url: emb.base_url.trim(),
          model: emb.model.trim(),
          api_key: embKey.clear ? '' : embKey.value || null,
        },
        mineru: {
          mode: mineru.mode,
          url: mineru.url.trim(),
          api_key: mineruKey.clear ? '' : mineruKey.value || null,
          tier: mineru.tier,
        },
      })
      apply(result.settings)
      if (result.sync.written && !result.sync.applied) {
        notify(t('settings.savedNoHot', { reason: result.sync.reason }), 'info')
      } else {
        notify(t('settings.savedHot'), 'success')
      }
      void loadDeps()
    } catch (err) {
      notify(err instanceof ApiError ? err.message : t('settings.saveFailed'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const test = async (target: string, label: string) => {
    setTesting(target)
    setTestInfo((current) => ({ ...current, [target]: '' }))
    try {
      const result = await api.testSetting(target)
      const detail = result.detail as Record<string, unknown>
      const extra =
        target === 'embedding'
          ? t('settings.embDims', {
              model: String(detail.model ?? ''),
              dims: String(detail.dims ?? ''),
            })
          : target === 'mineru'
            ? `MinerU ${String(detail.version ?? '')}`
            : target === 'opencode'
              ? `provider ${detail.provider_ready ? t('settings.providerReady') : t('settings.providerMissing')}`
              : ''
      setTestInfo((current) => ({
        ...current,
        [target]: `${t('settings.testOk', { ms: result.elapsed_ms })}${
          extra ? ' · ' + extra : ''
        }`,
      }))
      notify(t('settings.testOkLabel', { label }), 'success')
    } catch (err) {
      setTestInfo((current) => ({
        ...current,
        [target]: err instanceof ApiError ? err.message : t('settings.testFailed'),
      }))
      notify(t('settings.testFailLabel', { label }), 'error')
    } finally {
      setTesting(null)
    }
  }

  const langLabel = (value: LangPref) =>
    value === 'auto'
      ? t('settings.languageAuto')
      : value === 'zh'
        ? t('settings.languageZh')
        : t('settings.languageEn')

  if (loading || !settings) {
    return (
      <div className="page">
        <div className="list-loading">
          <Loader2 size={18} className="spin" /> {t('settings.loading')}
        </div>
      </div>
    )
  }

  const depItems = [
    { key: 'postgres', label: 'PostgreSQL', icon: Database },
    { key: 'age', label: 'Apache AGE', icon: Server },
    { key: 'opencode', label: t('settings.opencodeEngine'), icon: Cpu },
    { key: 'mineru', label: 'MinerU', icon: Sparkles },
  ]

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <div>
          <p className="eyebrow">System</p>
          <h1 className="page-title">{t('settings.title')}</h1>
          <p className="page-desc">{t('settings.desc')}</p>
        </div>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
          {t('settings.save')}
        </button>
      </header>

      <section className="panel settings-card">
        <div className="settings-head">
          <span className="settings-icon lang">
            <Languages size={17} />
          </span>
          <div>
            <h2>{t('settings.languageTitle')}</h2>
            <p>{t('settings.languageDesc')}</p>
          </div>
        </div>
        <div className="lang-switch" role="group" aria-label={t('settings.languageTitle')}>
          {LANG_OPTIONS.map((value) => (
            <button
              key={value}
              type="button"
              className={`lang-option ${pref === value ? 'active' : ''}`}
              aria-pressed={pref === value}
              onClick={() => setPref(value)}
            >
              {langLabel(value)}
            </button>
          ))}
        </div>
      </section>

      <section className="panel settings-card">
        <div className="settings-head">
          <span className="settings-icon llm">
            <Sparkles size={17} />
          </span>
          <div>
            <h2>{t('settings.llmTitle')}</h2>
            <p>{t('settings.llmDesc')}</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => test('llm', 'LLM')} disabled={testing === 'llm'}>
            {testing === 'llm' ? <Loader2 size={14} className="spin" /> : <PlugZap size={14} />}
            {t('common.test')}
          </button>
        </div>
        <div className="form-grid three">
          <label className="field field-span2">
            <span className="field-label">
              {t('settings.baseUrl')} <em>{t('settings.baseUrlHint')}</em>
            </span>
            <input
              className="input mono"
              placeholder="http://172.24.199.104:8000/v1"
              value={llm.base_url}
              onChange={(event) => setLlm({ ...llm, base_url: event.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">{t('settings.model')}</span>
            <input
              className="input mono"
              placeholder="qwen3.8-27b"
              value={llm.model}
              onChange={(event) => setLlm({ ...llm, model: event.target.value })}
            />
          </label>
          <label className="field field-full">
            <span className="field-label">{t('settings.apiKey')}</span>
            <div className="key-row">
              <input
                className="input mono"
                type={showLlmKey ? 'text' : 'password'}
                placeholder={settings.llm.key_set ? t('common.hiddenSaved') : t('common.notSet')}
                value={llmKey.value}
                onChange={(event) => setLlmKey({ value: event.target.value, clear: false })}
              />
              <button className="icon-btn" onClick={() => setShowLlmKey((v) => !v)} aria-label={t('common.showHide')}>
                {showLlmKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
              {settings.llm.key_set && !llmKey.clear ? (
                <button className="btn btn-ghost btn-sm" onClick={() => setLlmKey({ value: '', clear: true })}>
                  {t('common.clear')}
                </button>
              ) : null}
            </div>
          </label>
        </div>
        {testInfo.llm ? <p className="test-result">{testInfo.llm}</p> : null}
      </section>

      <section className="panel settings-card">
        <div className="settings-head">
          <span className="settings-icon emb">
            <Activity size={17} />
          </span>
          <div>
            <h2>{t('settings.embTitle')}</h2>
            <p>{t('settings.embDesc')}</p>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => test('embedding', t('settings.embTitle'))}
            disabled={testing === 'embedding'}
          >
            {testing === 'embedding' ? <Loader2 size={14} className="spin" /> : <PlugZap size={14} />}
            {t('common.test')}
          </button>
        </div>
        <div className="form-grid three">
          <label className="field field-span2">
            <span className="field-label">
              {t('settings.baseUrl')}{' '}
              <em>
                {settings.embedding.fallback_to_llm
                  ? t('settings.embFallbackNow')
                  : t('settings.embBaseHint')}
              </em>
            </span>
            <input
              className="input mono"
              placeholder={settings.llm.base_url || t('settings.embBasePlaceholder')}
              value={emb.base_url}
              onChange={(event) => setEmb({ ...emb, base_url: event.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">{t('settings.model')}</span>
            <input
              className="input mono"
              placeholder="bge-m3"
              value={emb.model}
              onChange={(event) => setEmb({ ...emb, model: event.target.value })}
            />
          </label>
          <label className="field field-full">
            <span className="field-label">{t('settings.apiKey')}</span>
            <div className="key-row">
              <input
                className="input mono"
                type={showEmbKey ? 'text' : 'password'}
                placeholder={settings.embedding.key_set ? t('common.hiddenSaved') : t('settings.embKeyPlaceholder')}
                value={embKey.value}
                onChange={(event) => setEmbKey({ value: event.target.value, clear: false })}
              />
              <button className="icon-btn" onClick={() => setShowEmbKey((v) => !v)} aria-label={t('common.showHide')}>
                {showEmbKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
              {settings.embedding.key_set && !embKey.clear ? (
                <button className="btn btn-ghost btn-sm" onClick={() => setEmbKey({ value: '', clear: true })}>
                  {t('common.clear')}
                </button>
              ) : null}
            </div>
          </label>
        </div>
        {testInfo.embedding ? <p className="test-result">{testInfo.embedding}</p> : null}
      </section>

      <section className="panel settings-card">
        <div className="settings-head">
          <span className="settings-icon mineru">
            <Cpu size={17} />
          </span>
          <div>
            <h2>{t('settings.mineruTitle')}</h2>
            <p>{t('settings.mineruDesc')}</p>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => test('mineru', 'MinerU')}
            disabled={testing === 'mineru'}
          >
            {testing === 'mineru' ? <Loader2 size={14} className="spin" /> : <PlugZap size={14} />}
            {t('common.test')}
          </button>
        </div>
        <div className="form-grid three">
          <label className="field field-full">
            <span className="field-label">{t('settings.service')}</span>
            <select
              className="input"
              value={mineru.mode}
              onChange={(event) => setMineru({ ...mineru, mode: event.target.value })}
            >
              <option value="agent">{t('settings.mineruAgent')}</option>
              <option value="precision">{t('settings.mineruPrecision')}</option>
              <option value="selfhost">{t('settings.mineruSelfhost')}</option>
            </select>
          </label>

          {mineru.mode === 'agent' ? (
            <p className="field-hint field-full">{t('settings.mineruAgentHint')}</p>
          ) : null}

          {mineru.mode === 'precision' ? (
            <>
              <label className="field field-full">
                <span className="field-label">
                  {t('settings.mineruToken')}
                  <em>{t('settings.mineruTokenHint')}</em>
                </span>
                <div className="input-row">
                  <input
                    className="input mono"
                    type={showMineruKey ? 'text' : 'password'}
                    placeholder={
                      settings.mineru.key_set ? t('common.hiddenSaved') : t('settings.mineruTokenPlaceholder')
                    }
                    value={mineruKey.value}
                    onChange={(event) => setMineruKey({ value: event.target.value, clear: false })}
                  />
                  <button className="icon-btn" onClick={() => setShowMineruKey((v) => !v)} aria-label={t('common.showHide')}>
                    {showMineruKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                  {settings.mineru.key_set && !mineruKey.clear ? (
                    <button className="btn btn-ghost btn-sm" onClick={() => setMineruKey({ value: '', clear: true })}>
                      {t('common.clear')}
                    </button>
                  ) : null}
                </div>
              </label>
              <p className="field-hint field-full">{t('settings.mineruPrecisionHint')}</p>
            </>
          ) : null}

          {mineru.mode === 'selfhost' ? (
            <>
              <label className="field field-span2">
                <span className="field-label">{t('settings.baseUrl')}</span>
                <input
                  className="input mono"
                  placeholder="http://172.24.199.104:8003"
                  value={mineru.url}
                  onChange={(event) => setMineru({ ...mineru, url: event.target.value })}
                />
              </label>
              <label className="field">
                <span className="field-label">{t('settings.tier')}</span>
                <select
                  className="input"
                  value={mineru.tier}
                  onChange={(event) => setMineru({ ...mineru, tier: event.target.value })}
                >
                  <option value="flash">{t('settings.tierFlash')}</option>
                  <option value="standard">{t('settings.tierStandard')}</option>
                  <option value="advanced">{t('settings.tierAdvanced')}</option>
                </select>
              </label>
              <label className="field field-full">
                <span className="field-label">
                  {t('settings.apiKey')}
                  <em>{t('common.optional')}</em>
                </span>
                <div className="input-row">
                  <input
                    className="input mono"
                    type={showMineruKey ? 'text' : 'password'}
                    placeholder={settings.mineru.key_set ? t('common.hiddenSaved') : t('common.notSet')}
                    value={mineruKey.value}
                    onChange={(event) => setMineruKey({ value: event.target.value, clear: false })}
                  />
                  <button className="icon-btn" onClick={() => setShowMineruKey((v) => !v)} aria-label={t('common.showHide')}>
                    {showMineruKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                  {settings.mineru.key_set && !mineruKey.clear ? (
                    <button className="btn btn-ghost btn-sm" onClick={() => setMineruKey({ value: '', clear: true })}>
                      {t('common.clear')}
                    </button>
                  ) : null}
                </div>
              </label>
              <p className="field-hint field-full">{t('settings.selfhostHint')}</p>
            </>
          ) : null}
        </div>
        {testInfo.mineru ? <p className="test-result">{testInfo.mineru}</p> : null}
      </section>

      <section className="panel settings-card">
        <div className="settings-head">
          <span className="settings-icon status">
            <Server size={17} />
          </span>
          <div>
            <h2>{t('settings.statusTitle')}</h2>
            <p>{depsAt ? t('settings.statusDescAt', { time: depsAt }) : t('settings.statusDesc')}</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={loadDeps} disabled={depsLoading}>
            {depsLoading ? <Loader2 size={14} className="spin" /> : <Activity size={14} />}
            {t('settings.recheck')}
          </button>
        </div>
        <div className="dep-grid">
          {depItems.map((item) => {
            const state = deps?.[item.key]
            const Icon = item.icon
            return (
              <div key={item.key} className={`dep-item ${state?.ok ? 'ok' : state ? 'bad' : ''}`}>
                <span className="dep-icon">
                  <Icon size={16} />
                </span>
                <div>
                  <b>{item.label}</b>
                  <span>
                    {state
                      ? state.ok
                        ? t('settings.running')
                        : t('settings.testFailed')
                      : t('settings.checking')}
                  </span>
                </div>
                {state ? (
                  state.ok ? (
                    <CheckCircle2 size={16} className="dep-ok" />
                  ) : (
                    <XCircle size={16} className="dep-bad" />
                  )
                ) : null}
              </div>
            )
          })}
        </div>
        <div className="dep-detail">
          <span>
            {t('settings.opencodeUrl')}
            <code>{settings.opencode.url}</code>
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => test('opencode', 'opencode')} disabled={testing === 'opencode'}>
            {testing === 'opencode' ? <Loader2 size={14} className="spin" /> : <PlugZap size={14} />}
            {t('settings.checkEngine')}
          </button>
        </div>
        {testInfo.opencode ? <p className="test-result">{testInfo.opencode}</p> : null}
      </section>
    </div>
  )
}
