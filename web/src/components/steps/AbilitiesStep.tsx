import type { Ability } from '../../api/types'
import { suggestedStandardArray } from '../../domain/actions'
import { emptyScores, type AbilityMethod } from '../../domain/character'
import { formatBonus } from '../../domain/derive'
import { ABILITIES, ABILITY_LABEL, POINT_BUY_BUDGET, STANDARD_ARRAY } from '../../domain/srd'
import { pointBuyCost } from '../../domain/validation'
import { Notice, Section } from '../ui'
import type { StepProps } from './types'

const METHODS: { id: AbilityMethod; label: string; hint: string }[] = [
  { id: 'standard', label: 'Matriz Padrão', hint: 'Distribua os valores 15, 14, 13, 12, 10 e 8, cada um uma vez.' },
  { id: 'pointbuy', label: 'Compra de Pontos', hint: `Comece com 8 em tudo e gaste até ${POINT_BUY_BUDGET} pontos (máximo 15 antes dos bônus).` },
  { id: 'manual', label: 'Manual / Rolagem', hint: 'Digite os valores que você rolou (por exemplo, 4d6 descartando o menor) ou que o Mestre definiu.' },
]

export function AbilitiesStep({ character, derived, change }: StepProps) {
  const scores = character.baseScores
  const method = character.abilityMethod
  const primary = derived.plan.cls?.primary_abilities ?? []
  const spent = pointBuyCost(scores)

  const setMethod = (next: AbilityMethod) =>
    change((c) => ({
      ...c,
      abilityMethod: next,
      baseScores: next === 'pointbuy' ? Object.fromEntries(ABILITIES.map((a) => [a, 8])) as Record<Ability, number> : next === 'manual' ? Object.fromEntries(ABILITIES.map((a) => [a, c.baseScores[a] ?? 10])) as Record<Ability, number> : emptyScores(),
    }))
  const setScore = (ability: Ability, value: number | null) => change((c) => ({ ...c, baseScores: { ...c.baseScores, [ability]: value } }))
  const usedValues = new Set(ABILITIES.map((a) => scores[a]).filter((v): v is number => v !== null))

  return (
    <div className="step">
      <h2>Atributos</h2>
      <p className="lead">
        Os seis atributos definem o que seu personagem faz bem. {primary.length > 0 && <>Para {derived.plan.cls?.name}, o mais importante é <strong>{primary.map((a) => ABILITY_LABEL[a]).join(derived.plan.cls?.primary_ability_logic === 'AND' ? ' e ' : ' ou ')}</strong>.</>}
      </p>

      <div className="segmented" role="group" aria-label="Método de geração">
        {METHODS.map((m) => (
          <button key={m.id} type="button" aria-pressed={method === m.id} onClick={() => setMethod(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      <p className="hint">{METHODS.find((m) => m.id === method)?.hint}</p>

      {method === 'standard' && (
        <button type="button" className="btn btn-ghost" onClick={() => change((c) => ({ ...c, baseScores: suggestedStandardArray(primary) }))}>
          Sugerir distribuição para {derived.plan.cls?.name ?? 'a classe'}
        </button>
      )}
      {method === 'pointbuy' && (
        <p className={`budget ${spent > POINT_BUY_BUDGET ? 'over' : ''}`}>
          Pontos gastos: <strong>{spent}</strong> / {POINT_BUY_BUDGET} (restam {POINT_BUY_BUDGET - spent})
        </p>
      )}

      <Section title="Valores">
        <div className="table-scroll">
        <table className="score-table">
          <thead>
            <tr>
              <th>Atributo</th>
              <th>Base</th>
              <th>Bônus</th>
              <th>Total</th>
              <th>Mod.</th>
            </tr>
          </thead>
          <tbody>
            {ABILITIES.map((a) => {
              const info = derived.scores[a]
              return (
                <tr key={a} className={primary.includes(a) ? 'primary' : ''}>
                  <th scope="row">
                    {ABILITY_LABEL[a]} <span className="muted">{a}</span>
                  </th>
                  <td>
                    {method === 'standard' && (
                      <select aria-label={`Valor de ${ABILITY_LABEL[a]}`} value={scores[a] ?? ''} onChange={(e) => setScore(a, e.target.value ? Number(e.target.value) : null)}>
                        <option value="">—</option>
                        {STANDARD_ARRAY.map((v) => (
                          <option key={v} value={v} disabled={usedValues.has(v) && scores[a] !== v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    )}
                    {method === 'pointbuy' && (
                      <span className="stepper">
                        <button type="button" aria-label={`Diminuir ${ABILITY_LABEL[a]}`} disabled={(scores[a] ?? 8) <= 8} onClick={() => setScore(a, (scores[a] ?? 8) - 1)}>
                          −
                        </button>
                        <output>{scores[a] ?? 8}</output>
                        <button type="button" aria-label={`Aumentar ${ABILITY_LABEL[a]}`} disabled={(scores[a] ?? 8) >= 15} onClick={() => setScore(a, (scores[a] ?? 8) + 1)}>
                          +
                        </button>
                      </span>
                    )}
                    {method === 'manual' && (
                      <input type="number" min={3} max={20} aria-label={`Valor de ${ABILITY_LABEL[a]}`} value={scores[a] ?? ''} onChange={(e) => setScore(a, e.target.value ? Math.min(20, Math.max(3, Number(e.target.value))) : null)} />
                    )}
                  </td>
                  <td>{info.bonus > 0 ? `+${info.bonus}` : '—'}</td>
                  <td>
                    <strong>{info.total}</strong>
                  </td>
                  <td>
                    <strong>{formatBonus(info.mod)}</strong>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
        {derived.plan.background && derived.plan.background.ability_scores.length > 0 && (
          <p className="hint">Os bônus vêm do antecedente {derived.plan.background.name} e dos aumentos de atributo de níveis mais altos.</p>
        )}
        {!derived.plan.background && <Notice>Escolha um antecedente na etapa “Origem” para aplicar os bônus de atributo.</Notice>}
      </Section>
    </div>
  )
}
