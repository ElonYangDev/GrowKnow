import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useLocation } from 'react-router-dom'
import { api, ApiError } from './api'
import { useI18n } from './i18n'
import type { Kb } from './types'

type ToastKind = 'success' | 'error' | 'info'

interface Toast {
  id: number
  kind: ToastKind
  message: string
}

interface AppStore {
  kbs: Kb[]
  kbsLoading: boolean
  refreshKbs: () => Promise<void>
  notify: (message: string, kind?: ToastKind) => void
  toasts: Toast[]
  dismiss: (id: number) => void
}

const AppContext = createContext<AppStore | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [kbs, setKbs] = useState<Kb[]>([])
  const [kbsLoading, setKbsLoading] = useState(true)
  const [toasts, setToasts] = useState<Toast[]>([])
  const counter = useRef(0)
  const location = useLocation()

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const notify = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      counter.current += 1
      const id = counter.current
      setToasts((current) => [...current.slice(-3), { id, kind, message }])
      window.setTimeout(() => dismiss(id), kind === 'error' ? 6000 : 3200)
    },
    [dismiss],
  )

  const refreshKbs = useCallback(async () => {
    try {
      const list = await api.listKb()
      setKbs(list)
    } catch (error) {
      if (error instanceof ApiError) {
        setKbs([])
      }
    } finally {
      setKbsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshKbs()
  }, [refreshKbs, location.pathname])

  const value = useMemo(
    () => ({ kbs, kbsLoading, refreshKbs, notify, toasts, dismiss }),
    [kbs, kbsLoading, refreshKbs, notify, toasts, dismiss],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppStore {
  const value = useContext(AppContext)
  if (!value) throw new Error('AppProvider missing')
  return value
}

export function useAsyncAction() {
  const { notify } = useApp()
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const run = useCallback(
    async <T,>(action: () => Promise<T>, success?: string): Promise<T | undefined> => {
      setBusy(true)
      try {
        const result = await action()
        if (success) notify(success, 'success')
        return result
      } catch (error) {
        notify(error instanceof Error ? error.message : t('common.actionFailed'), 'error')
        return undefined
      } finally {
        setBusy(false)
      }
    },
    [notify, t],
  )
  return { busy, run }
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

export function formatSize(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`
}
