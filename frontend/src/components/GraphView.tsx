import { useEffect, useMemo, useRef, useState } from 'react'
import { Maximize2, Minus, Plus, X } from 'lucide-react'
import { useI18n } from '../i18n'
import type { GraphAttributes, GraphEdge, GraphNode } from '../types'

const PALETTE = [
  '#2f6d5a',
  '#b57a3c',
  '#4a5f9e',
  '#8a5a7a',
  '#5c7d3a',
  '#a15a3a',
  '#3f7f92',
  '#7a6a3f',
]

interface SimNode extends GraphNode {
  x: number
  y: number
  degree: number
  color: string
}

function hashColor(type: string): string {
  let hash = 0
  for (let index = 0; index < type.length; index += 1) {
    hash = (hash * 31 + type.charCodeAt(index)) >>> 0
  }
  return PALETTE[hash % PALETTE.length]
}

function layout(nodes: GraphNode[], edges: GraphEdge[]): { sim: SimNode[]; width: number; height: number } {
  const degree = new Map<string, number>()
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1)
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1)
  }
  const limited = [...nodes]
    .sort((a, b) => (degree.get(b.name) ?? 0) - (degree.get(a.name) ?? 0))
    .slice(0, 320)
  const allowed = new Set(limited.map((node) => node.name))
  const localEdges = edges.filter((edge) => allowed.has(edge.source) && allowed.has(edge.target))

  const sim: SimNode[] = limited.map((node, index) => {
    const angle = (index / Math.max(limited.length, 1)) * Math.PI * 2
    const radius = 160 + (index % 7) * 26
    return {
      ...node,
      x: Math.cos(angle) * radius + (Math.random() - 0.5) * 40,
      y: Math.sin(angle) * radius + (Math.random() - 0.5) * 40,
      degree: degree.get(node.name) ?? 0,
      color: hashColor(node.type || '实体'),
    }
  })
  const byName = new Map(sim.map((node) => [node.name, node]))
  const springs = localEdges
    .map((edge) => [byName.get(edge.source), byName.get(edge.target)] as const)
    .filter((pair): pair is [SimNode, SimNode] => Boolean(pair[0] && pair[1]))

  const iterations = sim.length > 180 ? 140 : 240
  for (let tick = 0; tick < iterations; tick += 1) {
    const alpha = 1 - tick / iterations
    for (let i = 0; i < sim.length; i += 1) {
      for (let j = i + 1; j < sim.length; j += 1) {
        const a = sim[i]
        const b = sim[j]
        let dx = a.x - b.x
        let dy = a.y - b.y
        let dist2 = dx * dx + dy * dy
        if (dist2 < 1) {
          dx = Math.random() - 0.5
          dy = Math.random() - 0.5
          dist2 = 1
        }
        const force = (2600 * alpha) / dist2
        const dist = Math.sqrt(dist2)
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        a.x += fx
        a.y += fy
        b.x -= fx
        b.y -= fy
      }
    }
    for (const [a, b] of springs) {
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.sqrt(dx * dx + dy * dy) || 1
      const force = (dist - 96) * 0.012 * alpha
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      a.x += fx
      a.y += fy
      b.x -= fx
      b.y -= fy
    }
    for (const node of sim) {
      node.x -= node.x * 0.006 * alpha
      node.y -= node.y * 0.006 * alpha
    }
  }

  const xs = sim.map((node) => node.x)
  const ys = sim.map((node) => node.y)
  const minX = Math.min(...xs, -40)
  const maxX = Math.max(...xs, 40)
  const minY = Math.min(...ys, -40)
  const maxY = Math.max(...ys, 40)
  return {
    sim,
    width: maxX - minX + 80,
    height: maxY - minY + 80,
  }
}

function formatAttr(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function attrEntries(attributes?: GraphAttributes): [string, string][] {
  if (!attributes) return []
  return Object.entries(attributes)
    .map(([key, value]) => [key, formatAttr(value)] as [string, string])
    .filter(([, value]) => value.trim() !== '')
}

export default function GraphView({
  nodes,
  edges,
  truncated,
}: {
  nodes: GraphNode[]
  edges: GraphEdge[]
  truncated?: boolean
}) {
  const { t } = useI18n()
  const { sim: baseSim, width, height } = useMemo(() => layout(nodes, edges), [nodes, edges])
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({})
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 })
  const [hover, setHover] = useState<{ node: SimNode; x: number; y: number } | null>(null)
  const [edgeHover, setEdgeHover] = useState<{ edge: GraphEdge; x: number; y: number } | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const pan = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null)
  const nodeDrag = useRef<{
    name: string
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)

  const sim = useMemo(
    () =>
      baseSim.map((node) => {
        const position = positions[node.name]
        return position ? { ...node, x: position.x, y: position.y } : node
      }),
    [baseSim, positions],
  )

  useEffect(() => {
    setPositions({})
    setTransform({ x: 0, y: 0, k: 1 })
    setSelected(null)
    setHover(null)
    setEdgeHover(null)
  }, [baseSim])

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const factor = event.deltaY < 0 ? 1.12 : 0.89
      setTransform((current) => {
        const next = Math.min(4, Math.max(0.25, current.k * factor))
        return { ...current, k: next }
      })
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  const byName = useMemo(() => new Map(sim.map((node) => [node.name, node])), [sim])
  const edgeList = useMemo(
    () =>
      edges
        .map((edge) => ({ edge, a: byName.get(edge.source), b: byName.get(edge.target) }))
        .filter((item): item is { edge: GraphEdge; a: SimNode; b: SimNode } =>
          Boolean(item.a && item.b),
        ),
    [edges, byName],
  )

  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>()
    const link = (from: string, to: string) => {
      const set = map.get(from) ?? new Set<string>()
      set.add(to)
      map.set(from, set)
    }
    for (const edge of edges) {
      link(edge.source, edge.target)
      link(edge.target, edge.source)
    }
    return map
  }, [edges])

  const focus = hover?.node.name ?? selected
  const nearNames = useMemo(() => {
    if (!focus) return null
    return new Set([focus, ...(adjacency.get(focus) ?? [])])
  }, [focus, adjacency])

  const selectedNode = selected ? byName.get(selected) : undefined
  const selectedEdges = useMemo(
    () =>
      selected
        ? edges.filter((edge) => edge.source === selected || edge.target === selected)
        : [],
    [edges, selected],
  )
  const hoverAttrs = useMemo(() => attrEntries(hover?.node.attributes), [hover?.node.attributes])
  const edgeAttrs = useMemo(() => attrEntries(edgeHover?.edge.attributes), [edgeHover?.edge.attributes])
  const selectedAttrs = useMemo(() => attrEntries(selectedNode?.attributes), [selectedNode?.attributes])

  const viewBox = useMemo(() => {
    const xs = baseSim.map((node) => node.x)
    const ys = baseSim.map((node) => node.y)
    const pad = 60
    return {
      minX: Math.min(...xs, 0) - pad,
      minY: Math.min(...ys, 0) - pad,
      w: Math.max(...xs, width / 4) - Math.min(...xs, 0) + pad * 2,
      h: Math.max(...ys, height / 4) - Math.min(...ys, 0) + pad * 2,
    }
  }, [baseSim, width, height])

  const radius = (node: SimNode) => Math.min(22, 6 + Math.sqrt(node.degree + 1) * 4)
  const showLabels = sim.length <= 70
  const showEdgeLabels = edgeList.length <= 45

  const pointerToLocal = (dx: number, dy: number) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return null
    const scaleX = viewBox.w / rect.width
    const scaleY = viewBox.h / rect.height
    return { dx: (dx * scaleX) / transform.k, dy: (dy * scaleY) / transform.k }
  }

  return (
    <div className="graph-wrap" ref={containerRef}>
      <div className="graph-toolbar">
        <button
          className="icon-btn"
          onClick={() => setTransform((current) => ({ ...current, k: Math.min(4, current.k * 1.2) }))}
          aria-label={t('graph.zoomIn')}
        >
          <Plus size={15} />
        </button>
        <button
          className="icon-btn"
          onClick={() => setTransform((current) => ({ ...current, k: Math.max(0.25, current.k / 1.2) }))}
          aria-label={t('graph.zoomOut')}
        >
          <Minus size={15} />
        </button>
        <button className="icon-btn" onClick={() => setTransform({ x: 0, y: 0, k: 1 })} aria-label={t('graph.reset')}>
          <Maximize2 size={15} />
        </button>
      </div>
      {truncated ? <div className="graph-note">{t('graph.truncated')}</div> : null}
      <svg
        className="graph-svg"
        viewBox={`${viewBox.minX} ${viewBox.minY} ${viewBox.w} ${viewBox.h}`}
        onPointerDown={(event) => {
          if (nodeDrag.current) return
          pan.current = {
            x: event.clientX,
            y: event.clientY,
            tx: transform.x,
            ty: transform.y,
            moved: false,
          }
          event.currentTarget.setPointerCapture?.(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (nodeDrag.current) {
            const drag = nodeDrag.current
            const delta = pointerToLocal(event.clientX - drag.startX, event.clientY - drag.startY)
            if (!delta) return
            setPositions((current) => ({
              ...current,
              [drag.name]: { x: drag.originX + delta.dx, y: drag.originY + delta.dy },
            }))
            return
          }
          if (!pan.current) return
          const rect = containerRef.current?.getBoundingClientRect()
          if (!rect) return
          const scaleX = viewBox.w / rect.width
          const scaleY = viewBox.h / rect.height
          const dx = event.clientX - pan.current.x
          const dy = event.clientY - pan.current.y
          if (Math.abs(dx) + Math.abs(dy) > 3) pan.current.moved = true
          setTransform((current) => ({
            ...current,
            x: pan.current ? pan.current.tx + dx * scaleX : current.x,
            y: pan.current ? pan.current.ty + dy * scaleY : current.y,
          }))
        }}
        onPointerUp={(event) => {
          if (nodeDrag.current) {
            nodeDrag.current = null
            return
          }
          if (pan.current && !pan.current.moved) setSelected(null)
          pan.current = null
          event.currentTarget.releasePointerCapture?.(event.pointerId)
        }}
        onPointerLeave={() => {
          pan.current = null
          nodeDrag.current = null
          setHover(null)
          setEdgeHover(null)
        }}
      >
        <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
          {edgeList.map(({ edge, a, b }) => {
            const active = Boolean(focus) && (edge.source === focus || edge.target === focus)
            const midX = (a.x + b.x) / 2
            const midY = (a.y + b.y) / 2
            const showLabel = showEdgeLabels || active
            return (
              <g
                key={edge.id}
                className={`graph-edge ${focus ? (active ? 'lit' : 'dimmed') : ''}`}
              >
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
                {showLabel ? (
                  <text x={midX} y={midY - 3} className="edge-label">
                    {edge.predicate}
                  </text>
                ) : null}
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  className="edge-hit"
                  onMouseEnter={(event) => {
                    const rect = containerRef.current?.getBoundingClientRect()
                    setEdgeHover({
                      edge,
                      x: event.clientX - (rect?.left ?? 0),
                      y: event.clientY - (rect?.top ?? 0),
                    })
                  }}
                  onMouseMove={(event) => {
                    const rect = containerRef.current?.getBoundingClientRect()
                    setEdgeHover((current) =>
                      current
                        ? { ...current, x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }
                        : current,
                    )
                  }}
                  onMouseLeave={() => setEdgeHover(null)}
                />
              </g>
            )
          })}
          {sim.map((node) => {
            const isFocus = focus === node.name
            const isNear = nearNames ? nearNames.has(node.name) : false
            const labelVisible = showLabels || isFocus || (Boolean(focus) && isNear)
            return (
              <g
                key={node.name}
                className={`graph-node ${isFocus ? 'hot' : ''} ${focus && isNear && !isFocus ? 'near' : ''} ${
                  focus && !isNear ? 'dimmed' : ''
                }`}
                transform={`translate(${node.x} ${node.y})`}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  setSelected(node.name)
                  setHover(null)
                  setEdgeHover(null)
                  nodeDrag.current = {
                    name: node.name,
                    startX: event.clientX,
                    startY: event.clientY,
                    originX: node.x,
                    originY: node.y,
                  }
                  event.currentTarget.ownerSVGElement?.setPointerCapture?.(event.pointerId)
                }}
                onMouseEnter={(event) => {
                  const rect = containerRef.current?.getBoundingClientRect()
                  setHover({
                    node,
                    x: event.clientX - (rect?.left ?? 0),
                    y: event.clientY - (rect?.top ?? 0),
                  })
                  setEdgeHover(null)
                }}
                onMouseMove={(event) => {
                  const rect = containerRef.current?.getBoundingClientRect()
                  setHover((current) =>
                    current
                      ? { ...current, x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }
                      : current,
                  )
                }}
                onMouseLeave={() => setHover(null)}
              >
                <circle r={radius(node)} fill={node.color} />
                <circle r={radius(node) + 4} className="node-halo" />
                {labelVisible ? (
                  <text y={radius(node) + 15} className="node-label">
                    {node.name.length > 14 ? `${node.name.slice(0, 14)}…` : node.name}
                  </text>
                ) : null}
              </g>
            )
          })}
        </g>
      </svg>
      {hover ? (
        <div
          className="graph-tooltip"
          style={{ left: Math.min(hover.x + 14, (containerRef.current?.clientWidth ?? 400) - 250), top: hover.y + 14 }}
        >
          <div className="tooltip-name">{hover.node.name}</div>
          {hover.node.type ? <div className="tooltip-type">{hover.node.type}</div> : null}
          {hover.node.description ? <p>{hover.node.description}</p> : null}
          {hoverAttrs.slice(0, 3).map(([key, value]) => (
            <div className="tooltip-attr" key={key}>
              <span>{key}</span>
              <b>{value.length > 60 ? `${value.slice(0, 60)}…` : value}</b>
            </div>
          ))}
          <div className="tooltip-degree">{t('graph.related', { n: hover.node.degree })}</div>
        </div>
      ) : null}
      {edgeHover ? (
        <div
          className="graph-tooltip"
          style={{
            left: Math.min(edgeHover.x + 14, (containerRef.current?.clientWidth ?? 400) - 250),
            top: edgeHover.y + 14,
          }}
        >
          <div className="tooltip-name">{edgeHover.edge.predicate}</div>
          <div className="tooltip-type">
            {edgeHover.edge.source} → {edgeHover.edge.target}
          </div>
          {edgeHover.edge.description ? <p>{edgeHover.edge.description}</p> : null}
          {edgeAttrs.slice(0, 3).map(([key, value]) => (
            <div className="tooltip-attr" key={key}>
              <span>{key}</span>
              <b>{value.length > 60 ? `${value.slice(0, 60)}…` : value}</b>
            </div>
          ))}
        </div>
      ) : null}
      {selectedNode ? (
        <aside className="graph-detail">
          <div className="graph-detail-head">
            <div>
              <div className="graph-detail-name">{selectedNode.name}</div>
              {selectedNode.type ? <span className="graph-detail-type">{selectedNode.type}</span> : null}
            </div>
            <button className="icon-btn" onClick={() => setSelected(null)} aria-label={t('graph.closeDetail')}>
              <X size={14} />
            </button>
          </div>
          {selectedNode.description ? (
            <p className="graph-detail-desc">{selectedNode.description}</p>
          ) : null}
          {selectedAttrs.length ? (
            <div className="graph-attr-block">
              <div className="graph-detail-label">{t('graph.attributes', { n: selectedAttrs.length })}</div>
              {selectedAttrs.map(([key, value]) => (
                <div className="graph-attr-row" key={key}>
                  <span className="graph-attr-key">{key}</span>
                  <span className="graph-attr-value">{value}</span>
                </div>
              ))}
            </div>
          ) : null}
          {selectedEdges.length ? (
            <div className="graph-attr-block">
              <div className="graph-detail-label">{t('graph.relations', { n: selectedEdges.length })}</div>
              {selectedEdges.slice(0, 30).map((edge) => {
                const outgoing = edge.source === selected
                const neighbor = outgoing ? edge.target : edge.source
                return (
                  <button
                    className="graph-rel-row"
                    key={edge.id}
                    onClick={() => setSelected(neighbor)}
                  >
                    <span className="graph-rel-dir">{outgoing ? '→' : '←'}</span>
                    <span className="graph-rel-pred">{edge.predicate}</span>
                    <span className="graph-rel-target">{neighbor}</span>
                  </button>
                )
              })}
            </div>
          ) : null}
          {selectedNode.file_ids?.length ? (
            <div className="graph-detail-foot">{t('graph.sourceFiles', { n: selectedNode.file_ids.length })}</div>
          ) : null}
        </aside>
      ) : null}
      <div className="graph-legend">
        {[...new Set(sim.map((node) => node.type || '实体'))].slice(0, 6).map((type) => (
          <span key={type}>
            <i style={{ background: hashColor(type) }} />
            {type === '实体' ? t('graph.entity') : type}
          </span>
        ))}
      </div>
    </div>
  )
}
