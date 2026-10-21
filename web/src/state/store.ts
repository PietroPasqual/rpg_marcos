// Armazenamento das fichas no navegador (localStorage), com exportação/importação em arquivo JSON.

import { newId, normalizeCharacter, type Character } from '../domain/character'

const KEY = 'dnd5e-builder:characters:v1'

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

export const loadCharacters = (): Character[] => read().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

/** Insere ou atualiza uma ficha. Retorna false se o navegador recusou gravar (armazenamento cheio/bloqueado). */
export function saveCharacter(character: Character): boolean {
  const all = read()
  const index = all.findIndex((c) => c.id === character.id)
  if (index >= 0) all[index] = character
  else all.push(character)
  return write(all)
}

export function deleteCharacter(id: string): void {
  write(read().filter((c) => c.id !== id))
}

export function duplicateCharacter(id: string): Character | null {
  const original = read().find((c) => c.id === id)
  if (!original) return null
  const now = new Date().toISOString()
  const copy: Character = { ...structuredClone(original), id: newId(), name: `${original.name || 'Personagem'} (cópia)`, createdAt: now, updatedAt: now }
  saveCharacter(copy)
  return copy
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
