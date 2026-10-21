import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { bookHref } from './sections'

interface Props<T extends { slug: string; name: string }> {
  section: string
  title: string
  /** Itens já filtrados pelos controles da página. */
  items: T[]
  /** Todos os itens, para abrir um item por link direto mesmo que o filtro o esconda. */
  all: T[]
  selected?: string
  filters?: ReactNode
  searchText?: (item: T) => string
  row: (item: T) => ReactNode
  detail: (item: T) => ReactNode
  pageSize?: number
  intro?: ReactNode
}

export function MasterDetail<T extends { slug: string; name: string }>({ section, title, items, all, selected, filters, searchText, row, detail, pageSize = 60, intro }: Props<T>) {
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(pageSize)
  const text = searchText ?? ((item: T) => item.name)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? items.filter((item) => text(item).toLowerCase().includes(q)) : items
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, query])

  useEffect(() => setShown(pageSize), [visible, pageSize])

  const current = selected ? all.find((item) => item.slug === selected) : undefined
  const notFound = selected && !current

  return (
    <div className={`md-layout ${selected ? 'has-detail' : ''}`}>
      <aside className="md-list" aria-label={`Lista: ${title}`}>
        <div className="md-tools">
          <input type="search" placeholder={`Buscar em ${title.toLowerCase()}…`} aria-label={`Buscar em ${title}`} value={query} onChange={(e) => setQuery(e.target.value)} />
          {filters}
          <p className="muted md-count" aria-live="polite">
            {visible.length} {visible.length === 1 ? 'resultado' : 'resultados'}
          </p>
        </div>
        <ul>
          {visible.slice(0, shown).map((item) => (
            <li key={item.slug}>
              <a href={bookHref(section, item.slug)} className={`md-row ${item.slug === selected ? 'selected' : ''}`} aria-current={item.slug === selected ? 'page' : undefined}>
                {row(item)}
              </a>
            </li>
          ))}
        </ul>
        {visible.length > shown && (
          <button type="button" className="btn btn-ghost btn-sm md-more" onClick={() => setShown((n) => n + pageSize)}>
            Mostrar mais ({visible.length - shown})
          </button>
        )}
      </aside>

      <section className="md-detail">
        {current ? (
          <>
            <a className="md-back" href={bookHref(section)}>
              ← {title}
            </a>
            {detail(current)}
          </>
        ) : notFound ? (
          <div className="notice notice-warn">
            Não encontrei “{selected}” em {title.toLowerCase()}. <a href={bookHref(section)}>Voltar à lista</a>
          </div>
        ) : (
          <div className="md-placeholder">
            {intro ?? <p className="muted">Escolha um item na lista para ler.</p>}
          </div>
        )}
      </section>
    </div>
  )
}
