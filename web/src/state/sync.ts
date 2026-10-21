// Sincronização das fichas entre este navegador e o servidor de contas.
// Local primeiro: o site funciona sem login e sem rede; com login, a ficha mais recentemente editada vence
// e as exclusões viajam como marcadores, para que apagar em um aparelho apague nos outros.

import { useSyncExternalStore } from 'react'
import { AccountsError, accountsApi, accountsEnabled, type RemoteRecord } from '../api/accounts'
import { normalizeCharacter, type Character } from '../domain/character'
import { getSession, setSession, useSession, type Session } from './session'
import { clearLocalData, loadCharacters, onLocalChange, readTombstones, removeCharacterQuiet, writeCharacterQuiet, writeTombstones } from './store'

export interface Remote {
  id: string
  data: Character | null
  updatedAt: string
  deleted: boolean
}

export type SyncAction =
  | { kind: 'push'; character: Character }
  | { kind: 'pull'; character: Character; clearTombstone?: boolean }
  | { kind: 'remove-local'; id: string }
  | { kind: 'push-delete'; id: string; deletedAt: string }
  | { kind: 'clear-tombstone'; id: string }

/**
 * Decide o que fazer para deixar os dois lados iguais. Regras:
 * - a versão com `updatedAt` mais recente vence; empate não faz nada;
 * - uma exclusão vale para fichas editadas antes dela; uma edição posterior à exclusão ressuscita a ficha.
 */
export function planSync(local: Character[], tombstones: Record<string, string>, remote: Remote[]): SyncAction[] {
  const actions: SyncAction[] = []
  const localById = new Map(local.map((c) => [c.id, c]))
  const remoteById = new Map(remote.map((r) => [r.id, r]))
  const ids = new Set([...localById.keys(), ...Object.keys(tombstones), ...remoteById.keys()])

  for (const id of ids) {
    let mine = localById.get(id)
    const deletedAt = tombstones[id]
    const theirs = remoteById.get(id)

    // Marcador de exclusão local junto de uma ficha local: vale o que aconteceu por último.
    if (mine && deletedAt) {
      if (mine.updatedAt > deletedAt) actions.push({ kind: 'clear-tombstone', id })
      else {
        actions.push({ kind: 'remove-local', id })
        mine = undefined
      }
    }
    const stillDeleted = deletedAt !== undefined && !(mine && mine.updatedAt > deletedAt)

    if (!theirs) {
      if (mine) actions.push({ kind: 'push', character: mine })
      else if (stillDeleted) actions.push({ kind: 'push-delete', id, deletedAt: deletedAt! })
      continue
    }

    if (theirs.deleted) {
      if (mine) {
        if (theirs.updatedAt >= mine.updatedAt) actions.push({ kind: 'remove-local', id })
        else actions.push({ kind: 'push', character: mine })
      } else if (stillDeleted) {
        actions.push({ kind: 'clear-tombstone', id }) // o servidor já sabe
      }
      continue
    }

    const remoteCharacter = theirs.data
    if (!remoteCharacter) continue
    if (mine) {
      if (theirs.updatedAt > mine.updatedAt) actions.push({ kind: 'pull', character: remoteCharacter })
      else if (mine.updatedAt > theirs.updatedAt) actions.push({ kind: 'push', character: mine })
    } else if (stillDeleted) {
      if (theirs.updatedAt > deletedAt!) actions.push({ kind: 'pull', character: remoteCharacter, clearTombstone: true })
      else actions.push({ kind: 'push-delete', id, deletedAt: deletedAt! })
    } else {
      actions.push({ kind: 'pull', character: remoteCharacter })
    }
  }
  return actions
}

export interface SyncDeps {
  list: () => Promise<Remote[]>
  put: (character: Character) => Promise<void>
  remove: (id: string, deletedAt: string) => Promise<void>
  readLocal: () => Character[]
  readTombstones: () => Record<string, string>
  writeLocal: (character: Character) => void
  removeLocal: (id: string) => void
  writeTombstones: (tombstones: Record<string, string>) => void
}

export interface SyncResult {
  pushed: number
  pulled: number
  removed: number
  conflicts: number
}

const isConflict = (e: unknown): boolean => e instanceof AccountsError && e.status === 409

/** Executa um ciclo de sincronização. Conflitos (409) significam que o servidor tem algo mais novo: resolvem no próximo ciclo. */
export async function runSync(deps: SyncDeps): Promise<SyncResult> {
  const remote = await deps.list()
  const actions = planSync(deps.readLocal(), deps.readTombstones(), remote)
  const result: SyncResult = { pushed: 0, pulled: 0, removed: 0, conflicts: 0 }
  const tombstones = { ...deps.readTombstones() }
  let tombstonesChanged = false

  for (const action of actions) {
    try {
      switch (action.kind) {
        case 'push':
          await deps.put(action.character)
          result.pushed++
          break
        case 'pull':
          deps.writeLocal(action.character)
          result.pulled++
          if (action.clearTombstone) {
            delete tombstones[action.character.id]
            tombstonesChanged = true
          }
          break
        case 'remove-local':
          deps.removeLocal(action.id)
          result.removed++
          break
        case 'push-delete':
          await deps.remove(action.id, action.deletedAt)
          delete tombstones[action.id]
          tombstonesChanged = true
          break
        case 'clear-tombstone':
          delete tombstones[action.id]
          tombstonesChanged = true
          break
      }
    } catch (e) {
      if (!isConflict(e)) throw e
      result.conflicts++
    }
  }
  if (tombstonesChanged) deps.writeTombstones(tombstones)
  return result
}

// ---------------------------------------------------------------------------------------------
// Estado e agendamento (usados pela interface)
// ---------------------------------------------------------------------------------------------

export interface SyncState {
  phase: 'off' | 'idle' | 'syncing' | 'error'
  lastSyncedAt: string | null
  error: string | null
}

let state: SyncState = { phase: getSession() ? 'idle' : 'off', lastSyncedAt: null, error: null }
const listeners = new Set<() => void>()
const setState = (next: Partial<SyncState>) => {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state,
    () => state,
  )
}

function depsFor(session: Session): SyncDeps {
  return {
    list: async () => (await accountsApi.list(session.token)).map(toRemote),
    put: async (character) => void (await accountsApi.put(session.token, character)),
    remove: async (id, at) => void (await accountsApi.remove(session.token, id, at)),
    readLocal: loadCharacters,
    readTombstones,
    writeLocal: (character) => void writeCharacterQuiet(character),
    removeLocal: removeCharacterQuiet,
    writeTombstones,
  }
}

function toRemote(record: RemoteRecord): Remote {
  return { id: record.id, data: record.data ? normalizeCharacter(record.data) : null, updatedAt: record.updated_at, deleted: record.deleted }
}

let running = false
let again = false
let timer: ReturnType<typeof setTimeout> | undefined

/** Sincroniza agora (um ciclo por vez; pedidos durante um ciclo viram um novo ciclo ao final). */
export async function syncNow(): Promise<void> {
  const session = getSession()
  if (!accountsEnabled || !session) return
  if (running) {
    again = true
    return
  }
  running = true
  setState({ phase: 'syncing', error: null })
  try {
    const result = await runSync(depsFor(session))
    setState({ phase: 'idle', lastSyncedAt: new Date().toISOString(), error: null })
    if (result.pulled > 0 || result.removed > 0) window.dispatchEvent(new Event('characters-changed'))
    if (result.conflicts > 0) again = true
  } catch (e) {
    if (e instanceof AccountsError && e.status === 401) {
      setSession(null)
      setState({ phase: 'off', error: 'Sua sessão expirou. Entre de novo para continuar sincronizando.' })
    } else {
      setState({ phase: 'error', error: e instanceof Error ? e.message : 'Falha ao sincronizar.' })
    }
    again = false
  } finally {
    running = false
  }
  if (again) {
    again = false
    await syncNow()
  }
}

/** Pede uma sincronização em breve (agrupa várias edições seguidas). */
export function requestSync(delayMs = 1500): void {
  if (!accountsEnabled || !getSession()) return
  clearTimeout(timer)
  timer = setTimeout(() => void syncNow(), delayMs)
}

export async function signIn(session: Session): Promise<void> {
  setSession(session)
  setState({ phase: 'idle', error: null })
  await syncNow()
}

/** Sai da conta; com `wipeLocal`, apaga também as fichas deste navegador. */
export function signOut(wipeLocal: boolean): void {
  clearTimeout(timer)
  setSession(null)
  if (wipeLocal) {
    clearLocalData()
    window.dispatchEvent(new Event('characters-changed'))
  }
  setState({ phase: 'off', lastSyncedAt: null, error: null })
}

let started = false
/** Liga os gatilhos automáticos: ao abrir o site, ao editar, ao voltar a ficar online e ao voltar para a aba. */
export function startAutoSync(): void {
  if (started || typeof window === 'undefined') return
  started = true
  onLocalChange(() => requestSync())
  window.addEventListener('online', () => requestSync(0))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestSync(0)
  })
  requestSync(0)
}

export { useSession }
