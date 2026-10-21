import { useMemo, useState } from 'react'
import type { SpellData } from '../../api/types'
import { picksOf, withPicks } from '../../domain/character'
import { formatBonus } from '../../domain/derive'
import type { ClassPlan } from '../../domain/plan'
import { spellPools } from '../../domain/spells'
import { ABILITY_LABEL } from '../../domain/srd'
import { Chip, Markdown, Notice, Section } from '../ui'
import type { StepProps } from './types'

const levelLabel = (level: number) => (level === 0 ? 'Truque' : `Nível ${level}`)

export function SpellRow({ spell, extra }: { spell: SpellData; extra?: React.ReactNode }) {
  return (
    <details className="spell-details">
      <summary>
        <span className="spell-name">{spell.name}</span>
        <span className="spell-meta">
          {levelLabel(spell.level)} · {spell.school}
        </span>
        {spell.concentration && <Chip tone="warn">Conc.</Chip>}
        {spell.ritual && <Chip>Ritual</Chip>}
        {extra}
      </summary>
      <div className="spell-body">
        <p className="muted">
          {spell.casting_time} · {spell.range} · {[spell.components.verbal && 'V', spell.components.somatic && 'S', spell.components.material && `M (${spell.components.material_description ?? ''})`].filter(Boolean).join(', ')} · {spell.duration}
        </p>
        <Markdown>{spell.description}</Markdown>
        {spell.higher_levels && <Markdown>{`**Em níveis mais altos.** ${spell.higher_levels}`}</Markdown>}
      </div>
    </details>
  )
}

function SpellPicker({ title, hint, spells, selected, limit, onChange }: { title: string; hint?: string; spells: SpellData[]; selected: string[]; limit: number; onChange: (next: string[]) => void }) {
  const [query, setQuery] = useState('')
  const [level, setLevel] = useState('all')
  const levels = useMemo(() => [...new Set(spells.map((s) => s.level))].sort((a, b) => a - b), [spells])
  const visible = spells.filter((s) => (level === 'all' || s.level === Number(level)) && s.name.toLowerCase().includes(query.trim().toLowerCase()))
  const full = selected.length >= limit

  return (
    <Section title={title} hint={hint} count={{ current: selected.length, needed: limit }}>
      <div className="picker-tools">
        <input type="search" placeholder="Buscar magia…" aria-label={`Buscar em ${title}`} value={query} onChange={(e) => setQuery(e.target.value)} />
        {levels.length > 1 && (
          <select aria-label={`Filtrar ${title} por nível`} value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="all">Todos os níveis</option>
            {levels.map((l) => (
              <option key={l} value={l}>
                {levelLabel(l)}
              </option>
            ))}
          </select>
        )}
      </div>
      {selected.length > 0 && (
        <p className="selected-line">
          Escolhidas: {selected.map((slug) => spells.find((s) => s.slug === slug)?.name ?? slug).join(', ')}
        </p>
      )}
      <ul className="spell-list">
        {visible.map((spell) => {
          const checked = selected.includes(spell.slug)
          return (
            <li key={spell.slug} className={checked ? 'picked' : ''}>
              <input
                type="checkbox"
                aria-label={`Escolher ${spell.name}`}
                checked={checked}
                disabled={!checked && full}
                onChange={() => onChange(checked ? selected.filter((s) => s !== spell.slug) : [...selected, spell.slug])}
              />
              <SpellRow spell={spell} />
            </li>
          )
        })}
        {visible.length === 0 && <li className="muted">Nenhuma magia encontrada.</li>}
      </ul>
    </Section>
  )
}

function ClassSpells({ cp, derived, catalog, change }: StepProps & { cp: ClassPlan }) {
  const { spellcasting } = derived
  const { casting, picks } = cp
  const pools = spellPools(picks, cp, catalog)
  const multi = derived.plan.classes.length > 1
  const caster = spellcasting?.casters.find((c) => c.slug === cp.slug)
  const patchSpells = (p: Partial<typeof picks.spells>) => change((c) => withPicks(c, cp.index, { spells: { ...picksOf(c, cp.index).spells, ...p } }))
  const suffix = multi ? ` de ${cp.cls.name}` : ''

  return (
    <>
      {multi && <h3 className="class-block-title">{cp.cls.name} · nível {cp.level}</h3>}
      <p className="lead">
        Atributo de conjuração: <strong>{casting.ability ? ABILITY_LABEL[casting.ability] : '—'}</strong>
        {caster && (
          <>
            {' · '}CD de resistência <strong>{caster.dc}</strong>
            {' · '}Ataque de magia <strong>{formatBonus(caster.attack)}</strong>
          </>
        )}
      </p>

      {casting.cantrips > 0 && <SpellPicker title={`Truques${suffix}`} spells={pools.cantrips} selected={picks.spells.cantrips} limit={casting.cantrips} onChange={(cantrips) => patchSpells({ cantrips })} />}

      {casting.spellbook > 0 && (
        <SpellPicker
          title={`Grimório${suffix}`}
          hint={`Seu grimório começa com 6 magias e ganha 2 a cada nível. Só entram magias de níveis para os quais você tem espaços (até o nível ${casting.maxSpellLevel}).`}
          spells={pools.spellbook}
          selected={picks.spells.spellbook}
          limit={casting.spellbook}
          onChange={(spellbook) => patchSpells({ spellbook })}
        />
      )}

      {casting.prepared > 0 && (
        <SpellPicker
          title={`Magias preparadas${suffix}`}
          hint={cp.slug === 'wizard' ? 'Prepare magias do seu grimório. Você pode trocá-las após cada Descanso Longo.' : `Magias de nível 1 a ${casting.maxSpellLevel} da lista de ${cp.cls.name}. Você pode trocá-las após cada Descanso Longo.`}
          spells={pools.prepared}
          selected={picks.spells.prepared}
          limit={casting.prepared}
          onChange={(prepared) => patchSpells({ prepared })}
        />
      )}

      {casting.arcanumLevels.map((lvl) => (
        <SpellPicker
          key={lvl}
          title={`Arcana Mística (nível ${lvl})`}
          hint="Uma vez por Descanso Longo, sem gastar espaço de magia."
          spells={pools.arcanum[lvl] ?? []}
          selected={picks.spells.arcanum[String(lvl)] ? [picks.spells.arcanum[String(lvl)]!] : []}
          limit={1}
          onChange={(next) => patchSpells({ arcanum: { ...picks.spells.arcanum, [String(lvl)]: next[0] ?? '' } })}
        />
      ))}
    </>
  )
}

export function SpellsStep(props: StepProps) {
  const { derived } = props
  const { plan } = derived
  const casters = plan.classes.filter((cp) => cp.row?.spellcasting)
  const others = derived.spells.filter((s) => s.sources.some((src) => !['Classe', 'Preparada', 'Grimório', 'Arcana Mística'].some((own) => src === own || src.startsWith(`${own} (`)) && !src.startsWith('Guerreiro')))

  if (!plan.cls) return <Notice>Escolha uma classe para ver as magias dela.</Notice>

  const slotText = [
    Object.keys(plan.spellSlots).length > 0 ? `Espaços: ${Object.entries(plan.spellSlots).map(([lvl, n]) => `${n}× nível ${lvl}`).join(' · ')}` : null,
    plan.pactSlots ? `Espaços de Magia de Pacto: ${plan.pactSlots.count} de nível ${plan.pactSlots.level}` : null,
  ].filter(Boolean)

  return (
    <div className="step">
      <h2>Magias</h2>
      {casters.length === 0 ? (
        <Notice>{plan.classes.map((c) => c.cls.name).join(' e ')} não conjura magias neste nível. Se sua espécie ou algum talento concede magias, elas aparecem abaixo e na ficha.</Notice>
      ) : (
        <>
          <p className="muted">
            {slotText.join(' · ') || 'Nenhum espaço de magia ainda.'}
            {plan.classes.filter((c) => c.casting.ability).length > 1 && !plan.pactSlots?.count && ' (espaços combinados de todas as classes conjuradoras)'}
          </p>
          {casters.map((cp) => (
            <div key={cp.slug} className="class-block">
              <ClassSpells {...props} cp={cp} />
            </div>
          ))}
        </>
      )}

      {others.length > 0 && (
        <Section title="Magias de outras fontes" hint="Concedidas pela espécie, subclasse ou talentos.">
          <ul className="spell-list">
            {others.map((entry) => (
              <li key={entry.spell.slug}>
                <SpellRow spell={entry.spell} extra={<span className="muted">{entry.sources.join(', ')}</span>} />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}
