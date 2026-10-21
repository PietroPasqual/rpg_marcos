// Armazenamento das fichas no navegador (localStorage), com exportação/importação em arquivo JSON.
// Quando há login, o módulo de sincronização (sync.ts) envia as mudanças para o servidor de contas.

import { newId, normalizeCharacter, type Character } from '../domain/character'

const KEY = 'dnd5e-builder:characters:v1'
const TOMBSTONES_KEY = 'dnd5e-builder:deleted:v1'

type Listener = (change: { kind: 'save' | 'delete'; id: string }) => void
const listeners = new Set<Listener>()
/** Chamado a cada alteração feita pela pessoa (não pelas escritas da sincronização). */
export function onLocalChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function read(): Character[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(normalizeCharacter).filter((c): c is Character => c !== null)
  } catch {
    return []
  }
}

function write(characters: Character[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(characters))
    return true
  } catch {
    return false
  }
}

/** Fichas excluídas aqui e ainda não comunicadas ao servidor: id → momento da exclusão. */
export function readTombstones(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(TOMBSTONES_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export function writeTombstones(tombstones: Record<string, string>): void {
  try {
    localStorage.setItem(TOMBSTONES_KEY, JSON.stringify(tombstones))
  } catch {
    /* sem espaço: a exclusão só vale neste navegador */
  }
}

export const loadCharacters = (): Character[] => read().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

/** Escrita sem avisar ninguém: usada pela sincronização ao trazer fichas do servidor. */
export function writeCharacterQuiet(character: Character): boolean {
  const all = read()
  const index = all.findIndex((c) => c.id === character.id)
  if (index >= 0) all[index] = character
  else all.push(character)
  return write(all)
}

export function removeCharacterQuiet(id: string): void {
  write(read().filter((c) => c.id !== id))
}

/** Insere ou atualiza uma ficha. Retorna false se o navegador recusou gravar (armazenamento cheio/bloqueado). */
export function saveCharacter(character: Character): boolean {
  const ok = writeCharacterQuiet(character)
  listeners.forEach((l) => l({ kind: 'save', id: character.id }))
  return ok
}

export function deleteCharacter(id: string): void {
  removeCharacterQuiet(id)
  writeTombstones({ ...readTombstones(), [id]: new Date().toISOString() })
  listeners.forEach((l) => l({ kind: 'delete', id }))
}

export function duplicateCharacter(id: string): Character | null {
  const original = read().find((c) => c.id === id)
  if (!original) return null
  const now = new Date().toISOString()
  const copy: Character = { ...structuredClone(original), id: newId(), name: `${original.name || 'Personagem'} (cópia)`, createdAt: now, updatedAt: now }
  saveCharacter(copy)
  return copy
}

/** Apaga todas as fichas deste navegador (usado ao sair da conta em um computador compartilhado). */
export function clearLocalData(): void {
  write([])
  writeTombstones({})
}

export function downloadCharacter(character: Character): void {
  const blob = new Blob([JSON.stringify(character, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${(character.name || 'personagem').replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.dnd5e.json`
  link.click()
  URL.revokeObjectURL(url)
}

/** Lê um arquivo exportado; gera um novo id para não sobrescrever uma ficha existente. */
export async function importCharacterFile(file: File): Promise<Character> {
  let data: unknown
  try {
    data = JSON.parse(await file.text())
  } catch {
    throw new Error('O arquivo não é um JSON válido.')
  }
  const character = normalizeCharacter(data)
  if (!character) throw new Error('O arquivo não parece ser uma ficha exportada por este site.')
  const now = new Date().toISOString()
  const imported: Character = { ...character, id: newId(), updatedAt: now }
  saveCharacter(imported)
  return imported
}
