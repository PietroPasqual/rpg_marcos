import { useEffect, useRef, useState } from 'react'
import { getJson } from '../api/client'
import type { Catalog } from '../api/types'
import { ENTITY_LABEL, searchResultHref } from './sections'

interface Result {
  entity_type: string
  slug: string
  name: string
  summary: string
}

interface SearchResponse {
  query: string
  total_matches: number
  results_by_type: Record<string, Result[]>
}

export function BookSearch({ catalog }: { catalog: Catalog }) {
  const [query, setQuery] = useState('')
  const [response, setResponse] = useState<SearchResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResponse(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      getJson<SearchResponse>(`/api/v1/search?q=${encodeURIComponent(q)}&limit_per_type=6`)
        .then((r) => {
          if (!cancelled) {
            setResponse(r)
            setError(null)
          }
        })
        .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : 'Erro na busca.'))
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const parentOf = (slug: string) => catalog.featureOptions.find((o) => o.slug === slug)?.parent_class_slug
  const groups = response ? Object.entries(response.results_by_type) : []

  return (
    <div className="book-search" ref={box}>
      <input
        type="search"
        role="combobox"
        aria-expanded={open && query.trim().length >= 2}
        aria-label="Buscar em todo o livro"
        placeholder="Buscar em todo o livro…"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      />
      {open && query.trim().length >= 2 && (
        <div className="search-pop" role="listbox">
          {error && <p className="pending">{error}</p>}
          {response && groups.length === 0 && <p className="muted">Nada encontrado para “{response.query}”.</p>}
          {groups.map(([type, results]) => (
            <div key={type} className="search-group">
              <h4>{ENTITY_LABEL[type] ?? type}</h4>
              <ul>
                {results.map((r) => (
                  <li key={`${type}-${r.slug}`}>
                    <a role="option" aria-selected={false} href={searchResultHref(type, r.slug, parentOf)} onClick={() => setOpen(false)}>
                      <strong>{r.name}</strong>
                      <span className="muted">{r.summary.slice(0, 90)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
