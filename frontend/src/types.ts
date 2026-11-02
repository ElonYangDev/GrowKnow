export type KbKind = 'vector' | 'triple' | 'graph'
export type FileStatus = 'queued' | 'extracting' | 'ready' | 'failed' | 'canceled'

export interface Kb {
  id: number
  kb_key: string
  name: string
  description: string
  kind: KbKind
  kind_label: string
  created_at: string
  updated_at: string
  file_count: number
  knowledge_count: number
  pending_count: number
  graph_stats?: { nodes: number; edges: number }
}

export interface KbFile {
  id: number
  kb_id: number
  name: string
  size: number
  status: FileStatus
  status_label: string
  status_at: string
  stage: string
  progress: number | null
  page_slices: number
  skill_id: number | null
  skill_name: string | null
  error: string | null
  page_count: number | null
  knowledge_count: number
  created_at: string
}

export interface Chunk {
  id: number
  file_id: number
  file_name: string
  seq: number
  page_start: number | null
  page_end: number | null
  section: string
  content: string
  created_at: string
  vectorized?: boolean
}

export interface Triple {
  id: number
  file_id: number
  file_name: string
  seq: number
  page_start: number | null
  page_end: number | null
  subject: string
  subject_type: string
  predicate: string
  object: string
  object_type: string
  evidence: string
  created_at: string
}

export type GraphAttributes = Record<string, unknown>

export interface GraphNode {
  id: string
  name: string
  type: string
  description: string
  attributes?: GraphAttributes
  file_ids?: number[]
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  predicate: string
  description: string
  attributes?: GraphAttributes
}

export interface GraphData {
  kind: 'graph'
  nodes: GraphNode[]
  edges: GraphEdge[]
  truncated: boolean
  stats?: { nodes: number; edges: number }
}

export interface VectorContent {
  kind: 'vector'
  total: number
  page: number
  size: number
  items: Chunk[]
}

export interface TripleContent {
  kind: 'triple'
  total: number
  page: number
  size: number
  items: Triple[]
}

export type KbContent = VectorContent | TripleContent | GraphData

export interface Skill {
  id: number
  slug: string
  name: string
  description: string
  target: 'triple' | 'graph' | 'any'
  content: string
  builtin: boolean
  file_count?: number
  created_at: string
  updated_at: string
}

export interface Settings {
  llm: { base_url: string; model: string; api_key: string; key_set: boolean }
  embedding: {
    base_url: string
    model: string
    api_key: string
    key_set: boolean
    fallback_to_llm: boolean
  }
  mineru: { mode: string; url: string; api_key: string; key_set: boolean; tier: string }
  opencode: { url: string }
}

export interface SearchResult {
  id?: number
  file_id?: number
  file_name?: string
  seq?: number
  page_start?: number | null
  page_end?: number | null
  section?: string
  text?: string
  score?: number
  subject?: string
  subject_type?: string
  predicate?: string
  object?: string
  object_type?: string
  evidence?: string
  name?: string
  type?: string
  description?: string
  attributes?: GraphAttributes
  sources?: number
}

export interface SearchResponse {
  kind: KbKind
  query: string
  top_k: number
  mode: string
  note?: string
  results: SearchResult[]
  nodes?: GraphNode[]
  edges?: GraphEdge[]
}

export interface Invocations {
  kb_key: string
  url: string
  kind: KbKind
  python: string
  javascript: string
  http: string
}
