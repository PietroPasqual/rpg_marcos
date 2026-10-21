// Contas e sincronização de fichas: fala com as rotas /api/v1/auth e /api/v1/sync do servidor (accounts.py).
// Sem servidor de contas (ex.: GitHub Pages sem VITE_ACCOUNTS_URL), `ACCOUNTS_BASE` é null e o recurso fica oculto.

import type { Character } from '../domain/character'
import { STATIC_DATA } from './client'

const explicit = (import.meta.env.VITE_ACCOUNTS_URL as string | undefined)?.replace(/\/$/, '') || undefined
const apiBase = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? ''

/** URL base do servidor de contas; null se o site foi publicado sem um. */
export const ACCOUNTS_BASE: string | null = explicit ?? (STATIC_DATA ? null : apiBase)
export const accountsEnabled = ACCOUNTS_BASE !== null

export class AccountsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** Sem resposta do servidor (offline, servidor fora do ar, CORS). */
    readonly offline = false,
    readonly retryAfter?: number,
  ) {
    super(message)
  }
}

export interface RemoteSession {
  access_token: string
  user: { id: string; email: string }
}

export interface RemoteRecord {
  id: string
  data: Character | null
  updated_at: string
  deleted: boolean
}

async function call<T>(path: string, options: { method?: string; token?: string; body?: unknown } = {}): Promise<T> {
  if (ACCOUNTS_BASE === null) throw new AccountsError('Contas não estão disponíveis neste site.')
  let response: Response
  try {
    response = await fetch(`${ACCOUNTS_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    })
  } catch {
    throw new AccountsError('Não foi possível falar com o servidor de contas. Verifique a conexão.', undefined, true)
  }
  if (!response.ok) {
    let detail = response.statusText
    try {
      const problem = (await response.json()) as { detail?: unknown }
      if (typeof problem.detail === 'string') detail = problem.detail
    } catch {
      /* corpo sem JSON */
    }
    const retry = Number(response.headers.get('Retry-After'))
    throw new AccountsError(detail, response.status, false, Number.isFinite(retry) && retry > 0 ? retry : undefined)
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
}

export const accountsApi = {
  status: () => call<{ enabled: boolean; registration_open: boolean; min_password_length: number }>('/api/v1/auth/status'),
  register: (email: string, password: string) => call<RemoteSession>('/api/v1/auth/register', { method: 'POST', body: { email, password } }),
  login: (email: string, password: string) => call<RemoteSession>('/api/v1/auth/login', { method: 'POST', body: { email, password } }),
  me: (token: string) => call<{ id: string; email: string; created_at: string; characters: number }>('/api/v1/auth/me', { token }),
  changePassword: (token: string, current_password: string, new_password: string) =>
    call<RemoteSession>('/api/v1/auth/change-password', { method: 'POST', token, body: { current_password, new_password } }),
  logoutAll: (token: string) => call<{ detail: string }>('/api/v1/auth/logout-all', { method: 'POST', token }),
  deleteAccount: (token: string, password: string) => call<void>('/api/v1/auth/me', { method: 'DELETE', token, body: { password } }),
  list: async (token: string): Promise<RemoteRecord[]> => (await call<{ items: RemoteRecord[] }>('/api/v1/sync/characters', { token })).items,
  put: (token: string, character: Character) =>
    call<{ updated_at: string }>(`/api/v1/sync/characters/${encodeURIComponent(character.id)}`, { method: 'PUT', token, body: { data: character, updated_at: character.updatedAt } }),
  remove: (token: string, id: string, deletedAt: string) =>
    call<{ updated_at: string }>(`/api/v1/sync/characters/${encodeURIComponent(id)}?deleted_at=${encodeURIComponent(deletedAt)}`, { method: 'DELETE', token }),
}
