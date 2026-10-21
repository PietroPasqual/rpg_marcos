import { useMemo, useState } from 'react'
import { Chip, Notice } from '../../components/ui'
import { GlossaryDetail, tagLabel } from '../detail/rules'
import { useGlossary } from '../lazy'
import { MasterDetail } from '../MasterDetail'

export function GlossaryPage({ slug }: { slug?: string }) {
  const { data, error } = useGlossary()
  const [tag, setTag] = useState('')
  const items = useMemo(() => (data ?? []).filter((r) => !tag || r.tag === tag).sort((a, b) => a.name.localeCompare(b.name)), [data, tag])
  const tags = useMemo(() => [...new Set((data ?? []).map((r) => r.tag))].sort(), [data])

  if (error) return <Notice tone="error">{error}</Notice>
  if (!data) return <div className="loading" role="status"><div className="spinner" aria-hidden="true" />Carregando o glossário…</div>
  return (
    <MasterDetail
      section="glossario"
      title="Glossário"
      items={items}
      all={data}
      selected={slug}
      searchText={(r) => `${r.name} ${r.summary}`}
      filters={
        <select aria-label="Tipo de verbete" value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">Todos os tipos</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              {tagLabel(t)}
            </option>
          ))}
        </select>
      }
      row={(r) => (
        <>
          <span>{r.name}</span>
          {r.tag !== 'General Rule' && <Chip>{tagLabel(r.tag)}</Chip>}
        </>
      )}
      detail={(r) => <GlossaryDetail rule={r} all={data} />}
      intro={<p className="muted">155 verbetes do Glossário de Regras do SRD: condições, ações, áreas de efeito e definições. Escolha um na lista.</p>}
    />
  )
}
