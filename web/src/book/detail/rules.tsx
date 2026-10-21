import type { RuleData } from '../../api/types'
import { Chip, Markdown } from '../../components/ui'
import { bookHref } from '../sections'

const TAG_LABEL: Record<string, string> = {
  Action: 'Ação',
  'Area of Effect': 'Área de efeito',
  Attitude: 'Atitude',
  Condition: 'Condição',
  Hazard: 'Perigo',
  'General Rule': 'Regra geral',
}

export const tagLabel = (tag: string): string => TAG_LABEL[tag] ?? tag

export function GlossaryDetail({ rule, all }: { rule: RuleData; all: RuleData[] }) {
  const related = rule.see_also_slugs.map((slug) => all.find((r) => r.slug === slug)).filter((r): r is RuleData => !!r)
  return (
    <article className="entry">
      <h2>{rule.name}</h2>
      <p className="chips">
        <Chip tone="accent">{tagLabel(rule.tag)}</Chip>
      </p>
      <Markdown>{rule.description || rule.summary}</Markdown>
      {related.length > 0 && (
        <p>
          <strong>Veja também:</strong>{' '}
          {related.map((r, i) => (
            <span key={r.slug}>
              {i > 0 && ', '}
              <a href={bookHref('glossario', r.slug)}>{r.name}</a>
            </span>
          ))}
        </p>
      )}
    </article>
  )
}
