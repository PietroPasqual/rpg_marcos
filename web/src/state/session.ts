// Sessão de login guardada no navegador (token do servidor de contas).

import { useSyncExternalStore } from 'react'

export interface Session {
  token: string
  email: string
}

const KEY = 'dnd5e-builder:session:v1'
const listeners = new Set<() => void>()
let cached: Session | null | undefined

function read(): Session | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Session>
    return typeof parsed.token === 'string' && typeof parsed.email === 'string' ? { token: parsed.token, email: parsed.email } : null
  } catch {
    return null
  }
}

export function getSession(): Session | null {
  if (cached === undefined) cached = read()
  return cached
}

export function setSession(session: Session | null): void {
  cached = session
  try {
    if (session) localStorage.setItem(KEY, JSON.stringify(session))
    else localStorage.removeItem(KEY)
  } catch {
    /* armazenamento bloqueado: a sessão vale só até recarregar */
  }
  listeners.forEach((l) => l())
}

export function useSession(): Session | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSession,
    () => null,
  )
}
