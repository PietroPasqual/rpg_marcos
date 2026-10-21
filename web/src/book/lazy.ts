// Dados pesados do livro (monstros, itens mágicos, texto das regras) só são baixados quando alguém abre a seção.

import { useEffect, useState } from 'react'
import { loadGlossary, loadMagicItems, loadMonsters, loadRulePart, loadRuleToc } from '../api/client'
import type { MagicItemData, MonsterData, RuleData, RuleToc } from '../api/types'

const cache = new Map<string, Promise<unknown>>()

export function loadOnce<T>(key: string, loader: () => Promise<T>): Promise<T> {
  let promise = cache.get(key) as Promise<T> | undefined
  if (!promise) {
    promise = loader().catch((error: unknown) => {
      cache.delete(key) // permite tentar de novo depois de uma falha
      throw error
    })
    cache.set(key, promise)
  }
  return promise
}

export interface Loaded<T> {
  data: T | null
  error: string | null
}

export function useLoaded<T>(key: string, loader: () => Promise<T>): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ data: null, error: null })
  useEffect(() => {
    let cancelled = false
    setState({ data: null, error: null })
    loadOnce(key, loader)
      .then((data) => !cancelled && setState({ data, error: null }))
      .catch((e: unknown) => !cancelled && setState({ data: null, error: e instanceof Error ? e.message : 'Erro ao carregar.' }))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return state
}

export const useMonsters = () => useLoaded<MonsterData[]>('monsters', loadMonsters)
export const useMagicItems = () => useLoaded<MagicItemData[]>('magic-items', loadMagicItems)
export const useGlossary = () => useLoaded<RuleData[]>('glossary', loadGlossary)
export const useBookToc = () => useLoaded<RuleToc>('book-toc', loadRuleToc)
export const useBookPart = (part: string) => useLoaded<RuleData[]>(`book-part:${part}`, () => loadRulePart(part))
