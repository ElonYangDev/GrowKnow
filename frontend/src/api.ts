import { currentLang, translate } from './i18n'
import type {
  Invocations,
  Kb,
  KbContent,
  KbFile,
  KbKind,
  SearchResponse,
  Settings,
  Skill,
} from './types'

const BASE = '/api/v1'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set('Accept-Language', currentLang() === 'zh' ? 'zh-CN' : 'en')
  let response: Response
  try {
    response = await fetch(BASE + path, { ...init, headers })
  } catch {
    throw new ApiError(0, translate(currentLang(), 'api.networkError'))
  }
  let payload: { code?: number; message?: string; data?: T } | null = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  if (!response.ok || (payload && payload.code !== 0)) {
    const message =
      payload?.message ||
      translate(currentLang(), 'api.requestFailed', { status: response.status })
    throw new ApiError(response.status, message)
  }
  return (payload?.data ?? null) as T
}

function json(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

export const api = {
  // ---------- 知识库 ----------
  listKb: () => request<Kb[]>('/kb'),
  getKb: (key: string) => request<Kb>(`/kb/${encodeURIComponent(key)}`),
  createKb: (body: { name: string; kb_key: string; description: string; kind: KbKind }) =>
    request<Kb>('/kb', json(body)),
  updateKb: (key: string, body: { name?: string; kb_key?: string; description?: string }) =>
    request<Kb>(`/kb/${encodeURIComponent(key)}`, {
      ...json(body),
      method: 'PATCH',
    }),
  deleteKb: (key: string) =>
    request<null>(`/kb/${encodeURIComponent(key)}`, { method: 'DELETE' }),

  // ---------- 文件 ----------
  listFiles: (key: string) => request<KbFile[]>(`/kb/${encodeURIComponent(key)}/files`),
  uploadFiles: (key: string, form: FormData) =>
    request<KbFile[]>(`/kb/${encodeURIComponent(key)}/files`, { method: 'POST', body: form }),
  retryFile: (key: string, id: number) =>
    request<{ id: number }>(`/kb/${encodeURIComponent(key)}/files/${id}/retry`, {
      method: 'POST',
    }),
  cancelFile: (key: string, id: number) =>
    request<{ id: number }>(`/kb/${encodeURIComponent(key)}/files/${id}/cancel`, {
      method: 'POST',
    }),
  deleteFiles: (key: string, ids: number[]) =>
    request<{ deleted: number }>(`/kb/${encodeURIComponent(key)}/files`, {
      ...json({ file_ids: ids }),
      method: 'DELETE',
    }),
  downloadUrl: (key: string, id: number) =>
    `${BASE}/kb/${encodeURIComponent(key)}/files/${id}/download`,
  archiveUrl: (key: string, ids: number[]) =>
    `${BASE}/kb/${encodeURIComponent(key)}/files/archive?ids=${ids.join(',')}`,

  // ---------- 内容与检索 ----------
  content: (key: string, params: { page?: number; size?: number; fileIds?: number[] }) => {
    const search = new URLSearchParams()
    if (params.page) search.set('page', String(params.page))
    if (params.size) search.set('size', String(params.size))
    if (params.fileIds?.length) search.set('file_ids', params.fileIds.join(','))
    return request<KbContent>(`/kb/${encodeURIComponent(key)}/content?${search.toString()}`)
  },
  search: (key: string, body: { query: string; top_k: number; file_ids?: number[] }) =>
    request<SearchResponse>(`/kb/${encodeURIComponent(key)}/search`, json(body)),
  invocations: (key: string) =>
    request<Invocations>(`/kb/${encodeURIComponent(key)}/invocations`),

  // ---------- skill ----------
  listSkills: () => request<Skill[]>('/skills'),
  createSkill: (body: Partial<Skill>) => request<Skill>('/skills', json(body)),
  updateSkill: (id: number, body: Partial<Skill>) =>
    request<Skill>(`/skills/${id}`, { ...json(body), method: 'PATCH' }),
  deleteSkill: (id: number) => request<null>(`/skills/${id}`, { method: 'DELETE' }),

  // ---------- 设置 ----------
  settings: () => request<Settings>('/settings'),
  saveSettings: (body: unknown) =>
    request<{ settings: Settings; sync: { written: boolean; applied: boolean; reason: string } }>(
      '/settings',
      { ...json(body), method: 'PUT' },
    ),
  testSetting: (target: string) =>
    request<{ ok: boolean; elapsed_ms: number; detail: unknown }>(
      '/settings/test',
      json({ target }),
    ),
  healthDeps: () =>
    request<Record<string, { ok: boolean; [key: string]: unknown }>>('/health/deps'),
}
