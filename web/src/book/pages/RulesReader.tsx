import { useEffect, useMemo } from 'react'
import type { RuleData, RuleToc } from '../../api/types'
import { Markdown, Notice } from '../../components/ui'
import { useBookPart, useBookToc } from '../lazy'
import { PART_LABEL, bookHref } from '../sections'

interface Chapter {
  start: number
  end: number
}

function chapterOf(sections: RuleData[], index: number): Chapter {
  let start = index
  while (start > 0 && sections[start]!.depth > 2) start--
  let end = index + 1
  while (end < sections.length && sections[end]!.depth > 2) end++
  return { start, end }
}

function chapters(sections: RuleData[]): Chapter[] {
  const result: Chapter[] = []
  let i = 0
  while (i < sections.length) {
    const c = chapterOf(sections, i)
    result.push(c)
    i = c.end
  }
  return result
}

const HEADING = ['h2', 'h2', 'h2', 'h3', 'h4', 'h5'] as const

function PartReader({ part, slug }: { part: string; slug: string }) {
  const { data, error } = useBookPart(part)
  const sections = data ?? []
  const index = sections.findIndex((s) => s.slug === slug)
  const groups = useMemo(() => chapters(sections), [sections])

  useEffect(() => {
    if (index < 0) return
    const target = document.getElementById(`sec-${slug}`)
    if (target) target.scrollIntoView({ block: 'start' })
    else window.scrollTo({ top: 0 })
  }, [slug, index, data])

  if (error) return <Notice tone="error">{error}</Notice>
  if (!data) return <div className="loading" role="status"><div className="spinner" aria-hidden="true" />Carregando o capítulo…</div>
  if (index < 0) return <Notice tone="warn">Seção não encontrada. <a href={bookHref('regras')}>Voltar ao índice</a></Notice>

  const current = chapterOf(sections, index)
  const position = groups.findIndex((g) => g.start === current.start)
  const prev = groups[position - 1]
  const next = groups[position + 1]

  return (
    <article className="rules-content">
      <p className="muted breadcrumb">
        {PART_LABEL[part] ?? part}
      </p>
      {sections.slice(current.start, current.end).map((section) => {
        const Tag = HEADING[Math.min(section.depth, 5)] ?? 'h4'
        return (
          <section key={section.slug} id={`sec-${section.slug}`} className={`rule-section depth-${section.depth}`}>
            <Tag>
              {section.name}
              {section.page && <span className="page-ref" title="Página no PDF do SRD 5.2.1"> p. {section.page}</span>}
            </Tag>
            {section.description && <Markdown>{section.description}</Markdown>}
          </section>
        )
      })}
      <nav className="pager" aria-label="Capítulos">
        {prev ? (
          <a href={bookHref('regras', sections[prev.start]!.slug)}>← {sections[prev.start]!.name}</a>
        ) : (
          <span />
        )}
        {next ? <a href={bookHref('regras', sections[next.start]!.slug)}>{sections[next.start]!.name} →</a> : <span />}
      </nav>
    </article>
  )
}

function Toc({ toc, slug }: { toc: RuleToc; slug?: string }) {
  const currentPart = toc.parts.find((p) => p.sections.some((s) => s.slug === slug))
  return (
    <nav className="rules-toc" aria-label="Índice do livro de regras">
      {toc.parts.map((part) => (
        <details key={part.slug} open={part === currentPart || (!slug && false)}>
          <summary>{PART_LABEL[part.name] ?? part.name}</summary>
          <ul>
            {part.sections
              .filter((s) => s.depth === 2 || s.depth === 3)
              .map((s) => (
                <li key={s.slug} className={`toc-depth-${s.depth}`}>
                  <a href={bookHref('regras', s.slug)} aria-current={s.slug === slug ? 'page' : undefined} className={s.slug === slug ? 'current' : ''}>
                    {s.name}
                  </a>
                </li>
              ))}
          </ul>
        </details>
      ))}
    </nav>
  )
}

export function RulesReader({ slug }: { slug?: string }) {
  const { data: toc, error } = useBookToc()
  if (error) return <Notice tone="error">{error}</Notice>
  if (!toc) return <div className="loading" role="status"><div className="spinner" aria-hidden="true" />Carregando o índice…</div>
  const part = slug ? toc.parts.find((p) => p.sections.some((s) => s.slug === slug)) : undefined

  return (
    <div className={`rules-layout ${slug ? 'has-detail' : ''}`}>
      <Toc toc={toc} slug={slug} />
      <div className="rules-main">
        {slug && (
          <a className="md-back" href={bookHref('regras')}>
            ← Índice
          </a>
        )}
        {part && slug ? (
          <PartReader part={part.name} slug={slug} />
        ) : slug ? (
          <Notice tone="warn">
            Seção não encontrada. <a href={bookHref('regras')}>Voltar ao índice</a>
          </Notice>
        ) : (
          <div className="rules-landing">
            <h2>Regras do jogo</h2>
            <p className="lead">O texto das regras do SRD 5.2.1, na ordem do livro. Escolha uma parte para começar.</p>
            <div className="card-grid">
              {toc.parts.map((p) => {
                const chaptersOfPart = p.sections.filter((s) => s.depth === 2)
                return (
                  <section key={p.slug} className="part-card">
                    <h3>{PART_LABEL[p.name] ?? p.name}</h3>
                    <ul>
                      {chaptersOfPart.slice(0, 8).map((c) => (
                        <li key={c.slug}>
                          <a href={bookHref('regras', c.slug)}>{c.name}</a>
                        </li>
                      ))}
                      {chaptersOfPart.length > 8 && <li className="muted">e mais {chaptersOfPart.length - 8}…</li>}
                    </ul>
                  </section>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
