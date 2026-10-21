import { useEffect, useState } from 'react'
import type { Catalog } from '../api/types'
import type { Character } from '../domain/character'
import { formatBonus, type Derived } from '../domain/derive'
import { ABILITIES, ABILITY_LABEL } from '../domain/srd'
import { STEPS, requiredIssues, type Issue, type StepId } from '../domain/validation'
import { Chip, Collapsible, Markdown, Notice } from './ui'
import { SpellRow } from './steps/SpellsStep'

interface Props {
  character: Character
  derived: Derived
  catalog: Catalog
  issues: Issue[]
  onGoto: (step: StepId) => void
}

const LEVEL_NAME = (level: number) => (level === 0 ? 'Truques' : `Nível ${level}`)

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  )
}

export function Sheet({ character, derived, catalog, issues, onGoto }: Props) {
  const { plan } = derived
  const [expanded, setExpanded] = useState(false)

  // Ao imprimir, abre todas as seções recolhidas para que o conteúdo apareça no papel.
  useEffect(() => {
    const before = () => setExpanded(true)
    const after = () => setExpanded(false)
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', after)
    return () => {
      window.removeEventListener('beforeprint', before)
      window.removeEventListener('afterprint', after)
    }
  }, [])

  const pending = requiredIssues(issues)
  const lineage = plan.species?.lineages.find((l) => l.slug === character.speciesChoice.lineage)
  const spellLevels = [...new Set(derived.spells.map((s) => s.spell.level))].sort((a, b) => a - b)
  const open = expanded || undefined

  return (
    <article className="sheet">
      {pending.length > 0 && (
        <Notice tone="warn">
          <strong>Ficha incompleta ({pending.length} pendência{pending.length > 1 ? 's' : ''}).</strong> Os valores abaixo podem mudar quando você terminar:
          <ul className="issue-list">
            {pending.slice(0, 6).map((issue, i) => (
              <li key={i}>
                <button type="button" className="link" onClick={() => onGoto(issue.step)}>
                  {STEPS.find((s) => s.id === issue.step)?.label}
                </button>
                : {issue.message}
              </li>
            ))}
            {pending.length > 6 && <li className="muted">e mais {pending.length - 6}…</li>}
          </ul>
        </Notice>
      )}

      <header className="sheet-header">
        <h1>{character.name || 'Personagem sem nome'}</h1>
        <p>
          {plan.classes.length > 0
            ? plan.classes.map((c) => `${c.cls.name} ${c.level}${c.subclass ? ` (${c.subclass.name})` : ''}`).join(' / ')
            : 'Sem classe'}
          {plan.species && ` · ${plan.species.name}${lineage ? ` (${lineage.name})` : ''}`}
          {plan.background && ` · ${plan.background.name}`}
          {character.alignment && ` · ${character.alignment}`}
          {character.speciesChoice.size && ` · ${character.speciesChoice.size}`}
        </p>
      </header>

      <div className="stats-strip">
        <Stat label="Classe de Armadura" value={derived.ac.value} sub={derived.ac.formula} />
        <Stat label="Iniciativa" value={formatBonus(derived.initiative)} />
        <Stat label="Velocidade" value={`${derived.speed} ft`} />
        <Stat label="Pontos de Vida" value={derived.hp} sub={derived.hitDice} />
        <Stat label="Proficiência" value={formatBonus(derived.proficiencyBonus)} sub={plan.classes.length > 1 ? `nível ${plan.level}` : undefined} />
        <Stat label="Percepção passiva" value={derived.passivePerception} />
        {derived.darkvision ? <Stat label="Visão no escuro" value={`${derived.darkvision} ft`} /> : null}
      </div>

      {derived.warnings.map((w) => (
        <Notice key={w} tone="warn">
          {w}
        </Notice>
      ))}

      <div className="sheet-grid">
        <section className="sheet-col">
          <h2>Atributos</h2>
          <div className="ability-grid">
            {ABILITIES.map((a) => (
              <div key={a} className="ability-box">
                <span className="stat-label">{ABILITY_LABEL[a]}</span>
                <span className="ability-mod">{formatBonus(derived.scores[a].mod)}</span>
                <span className="ability-score">{derived.scores[a].total}</span>
              </div>
            ))}
          </div>

          <h2>Salvaguardas</h2>
          <ul className="prof-list">
            {derived.saves.map((s) => (
              <li key={s.ability} className={s.proficient ? 'is-prof' : ''}>
                <span className="dot" aria-label={s.proficient ? 'Proficiente' : 'Sem proficiência'} />
                <span className="prof-mod">{formatBonus(s.mod)}</span> {ABILITY_LABEL[s.ability]}
              </li>
            ))}
          </ul>

          <h2>Perícias</h2>
          <ul className="prof-list">
            {derived.skills.map((s) => (
              <li key={s.name} className={s.level === 'proficient' || s.level === 'expertise' ? 'is-prof' : ''}>
                <span className={`dot ${s.level === 'expertise' ? 'dot-expert' : ''}`} aria-label={{ none: 'Sem proficiência', half: 'Meia proficiência', proficient: 'Proficiente', expertise: 'Especialização' }[s.level]} />
                <span className="prof-mod">{formatBonus(s.mod)}</span> {s.name} <span className="muted">({s.ability})</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="sheet-col sheet-col-wide">
          <h2>Ataques</h2>
          <div className="table-scroll">
          <table className="attacks">
            <thead>
              <tr>
                <th>Arma</th>
                <th>Ataque</th>
                <th>Dano</th>
                <th>Propriedades</th>
              </tr>
            </thead>
            <tbody>
              {derived.attacks.map((a) => (
                <tr key={a.id}>
                  <th scope="row">
                    {a.name}
                    {a.quantity > 1 && <span className="muted"> ×{a.quantity}</span>}
                    {a.mastery && <Chip tone="accent">{a.mastery}</Chip>}
                  </th>
                  <td>{formatBonus(a.bonus)}</td>
                  <td>
                    {a.damage} {a.damageType}
                  </td>
                  <td className="muted">
                    {[...a.properties, a.note].filter(Boolean).join(', ')}
                    {a.extras.length > 0 && (
                      <ul className="attack-extras">
                        {a.extras.map((extra) => (
                          <li key={extra}>{extra}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          {derived.spellcasting && (
            <>
              <h2>Conjuração</h2>
              <div className="table-scroll">
                <table className="attacks">
                  <thead>
                    <tr>
                      <th>Classe</th>
                      <th>Atributo</th>
                      <th>CD de resistência</th>
                      <th>Ataque de magia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {derived.spellcasting.casters.map((c) => (
                      <tr key={c.slug}>
                        <th scope="row">{c.name}</th>
                        <td>{ABILITY_LABEL[c.ability]}</td>
                        <td>{c.dc}</td>
                        <td>{formatBonus(c.attack)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="slots">
                {[
                  Object.keys(derived.spellcasting.slots).length > 0
                    ? Object.entries(derived.spellcasting.slots)
                        .map(([lvl, n]) => `Nível ${lvl}: ${n}`)
                        .join(' · ')
                    : null,
                  derived.spellcasting.pact ? `Magia de Pacto: ${derived.spellcasting.pact.count} espaço(s) de nível ${derived.spellcasting.pact.level}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'Sem espaços de magia ainda'}
              </p>
            </>
          )}

          {derived.defenses.length > 0 && (
            <>
              <h2>Defesas</h2>
              <ul className="plain">
                {derived.defenses.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </>
          )}

          {derived.resources.length > 0 && (
            <>
              <h2>Recursos e usos</h2>
              <dl className="facts">
                {derived.resources.map((r) => (
                  <div key={r.label} className="fact-row">
                    <dt>{r.label}</dt>
                    <dd>{r.value}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}

          <h2>Proficiências e idiomas</h2>
          <dl className="facts">
            <dt>Armaduras</dt>
            <dd>{derived.proficiencies.armor.join(', ') || 'Nenhuma'}</dd>
            <dt>Armas</dt>
            <dd>{derived.proficiencies.weapons.join('; ') || 'Nenhuma'}</dd>
            <dt>Ferramentas</dt>
            <dd>{derived.proficiencies.tools.join(', ') || 'Nenhuma'}</dd>
            <dt>Idiomas</dt>
            <dd>{derived.languages.join(', ')}</dd>
          </dl>

          <h2>Equipamento</h2>
          {character.inventory.length === 0 ? (
            <p className="muted">Sem itens.</p>
          ) : (
            <ul className="gear-list">
              {character.inventory.map((i) => (
                <li key={i.id}>
                  {i.quantity > 1 ? `${i.quantity}× ` : ''}
                  {i.name}
                  {i.equipped && <Chip tone="good">equipado</Chip>}
                </li>
              ))}
            </ul>
          )}
          <p className="muted">
            Ouro: <strong>{derived.gold} GP</strong> · Peso: {derived.weightCarried} / {derived.carryCapacity} lb
          </p>
        </section>
      </div>

      {spellLevels.length > 0 && (
        <section className="sheet-block">
          <h2>Magias</h2>
          {spellLevels.map((level) => (
            <div key={level} className="spell-level">
              <h3>{LEVEL_NAME(level)}</h3>
              <ul className="spell-list">
                {derived.spells
                  .filter((s) => s.spell.level === level)
                  .map((entry) => (
                    <li key={entry.spell.slug}>
                      <SpellRow spell={entry.spell} extra={<span className="muted">{entry.sources.join(' · ')}{entry.ability ? ` · ${entry.ability}` : ''}{entry.note ? ` · ${entry.note}` : ''}</span>} />
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      <section className="sheet-block">
        <h2>Características</h2>
        <div className="stack">
          {derived.features.map((f, i) => (
            <Collapsible key={`${f.source}-${f.name}-${i}`} open={open} title={f.name} meta={`${f.source}${f.level ? ` · nível ${f.level}` : ''}${f.uses ? ` · ${f.uses}` : ''}`}>
              <Markdown>{f.text}</Markdown>
            </Collapsible>
          ))}
        </div>
      </section>

      {(character.appearance || character.personality || character.ideals || character.bonds || character.flaws || character.backstory) && (
        <section className="sheet-block">
          <h2>Personagem</h2>
          <dl className="facts">
            {(
              [
                ['Aparência', character.appearance],
                ['Personalidade', character.personality],
                ['Ideais', character.ideals],
                ['Vínculos', character.bonds],
                ['Defeitos', character.flaws],
                ['História', character.backstory],
              ] as const
            )
              .filter(([, text]) => text)
              .map(([label, text]) => (
                <div key={label} className="fact-row">
                  <dt>{label}</dt>
                  <dd className="prewrap">{text}</dd>
                </div>
              ))}
          </dl>
        </section>
      )}

      <footer className="sheet-footer">
        <small>{catalog.attribution}</small>
      </footer>
    </article>
  )
}
