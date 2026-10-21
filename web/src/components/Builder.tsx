import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Catalog } from '../api/types'
import type { Character } from '../domain/character'
import { autofill } from '../domain/autofill'
import { derive, formatBonus } from '../domain/derive'
import { prune } from '../domain/prune'
import { ABILITIES, ABILITY_LABEL } from '../domain/srd'
import { STEPS, requiredIssues, validate, type StepId } from '../domain/validation'
import { downloadCharacter, loadCharacters, saveCharacter } from '../state/store'
import { Sheet } from './Sheet'
import { AbilitiesStep } from './steps/AbilitiesStep'
import { ChoicesStep } from './steps/ChoicesStep'
import { ClassStep } from './steps/ClassStep'
import { DetailsStep } from './steps/DetailsStep'
import { EquipmentStep } from './steps/EquipmentStep'
import { OriginStep } from './steps/OriginStep'
import { SpellsStep } from './steps/SpellsStep'
import type { StepProps } from './steps/types'
import { Notice } from './ui'

export type BuilderStep = StepId | 'sheet'

const STEP_VIEWS: Record<StepId, (props: StepProps) => React.JSX.Element | null> = {
  class: ClassStep,
  origin: OriginStep,
  abilities: AbilitiesStep,
  choices: ChoicesStep,
  spells: SpellsStep,
  equipment: EquipmentStep,
  details: DetailsStep,
}

// Cada etapa é um componente próprio (com seus hooks); chamá-la como função quebraria as regras dos hooks.
function StepView({ step, ...props }: StepProps & { step: StepId }) {
  const View = STEP_VIEWS[step]
  return <View {...props} />
}

const ORDER: BuilderStep[] = [...STEPS.map((s) => s.id), 'sheet']

export function Builder({ catalog, id, step, go }: { catalog: Catalog; id: string; step: BuilderStep; go: (path: string) => void }) {
  const [character, setCharacter] = useState<Character | null>(() => loadCharacters().find((c) => c.id === id) ?? null)
  const [saveFailed, setSaveFailed] = useState(false)

  const change = useCallback(
    (mutate: (c: Character) => Character) => setCharacter((prev) => (prev ? { ...prune(mutate(prev), catalog), updatedAt: new Date().toISOString() } : prev)),
    [catalog],
  )

  useEffect(() => {
    if (character) setSaveFailed(!saveCharacter(character))
  }, [character])

  const derived = useMemo(() => (character ? derive(character, catalog) : null), [character, catalog])
  const issues = useMemo(() => (character ? validate(character, catalog) : []), [character, catalog])

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [step])

  if (!character || !derived) {
    return (
      <Notice tone="error">
        Não encontrei esse personagem neste navegador.{' '}
        <a href="#/">Voltar para a lista</a>
      </Notice>
    )
  }

  const goStep = (next: BuilderStep) => go(`/c/${id}/${next}`)
  const index = ORDER.indexOf(step)
  const required = requiredIssues(issues)
  const pendingByStep = (s: StepId) => required.filter((i) => i.step === s).length
  const stepProps: StepProps = { character, derived, catalog, change }

  return (
    <div className="builder">
      <header className="builder-head no-print">
        <a className="back" href="#/">
          ← Meus personagens
        </a>
        <h1>{character.name || 'Novo personagem'}</h1>
        <div className="head-actions">
          {saveFailed && <span className="save-error">Não foi possível salvar no navegador</span>}
          {character.classSlug && (
            <button type="button" className="btn btn-ghost" title="Completa só o que ainda falta, com escolhas padrão; não altera o que você já escolheu." onClick={() => change((c) => autofill(c, catalog))}>
              Preencher o que falta
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => downloadCharacter(character)}>
            Exportar JSON
          </button>
          {step === 'sheet' && (
            <button type="button" className="btn" onClick={() => window.print()}>
              Imprimir / PDF
            </button>
          )}
        </div>
      </header>

      <nav className="steps-nav no-print" aria-label="Etapas da criação">
        <ol>
          {STEPS.map((s, i) => {
            const pending = pendingByStep(s.id)
            return (
              <li key={s.id}>
                <button type="button" className={step === s.id ? 'current' : ''} aria-current={step === s.id ? 'step' : undefined} onClick={() => goStep(s.id)}>
                  <span className="step-number">{i + 1}</span>
                  <span className="step-label">{s.label}</span>
                  {pending > 0 ? <span className="badge badge-warn" title={`${pending} pendência(s)`}>{pending}</span> : character.classSlug && <span className="badge badge-ok" aria-label="Completa">✓</span>}
                </button>
              </li>
            )
          })}
          <li>
            <button type="button" className={step === 'sheet' ? 'current' : ''} aria-current={step === 'sheet' ? 'step' : undefined} onClick={() => goStep('sheet')}>
              <span className="step-number">★</span>
              <span className="step-label">Ficha</span>
            </button>
          </li>
        </ol>
      </nav>

      <div className={`builder-body ${step === 'sheet' ? 'is-sheet' : ''}`}>
        <main>
          {step === 'sheet' ? <Sheet character={character} derived={derived} catalog={catalog} issues={issues} onGoto={goStep} /> : <StepView step={step} {...stepProps} />}
        </main>

        {step !== 'sheet' && (
          <aside className="summary no-print" aria-label="Resumo do personagem">
            <h2>{character.name || 'Resumo'}</h2>
            <p className="muted">
              {derived.plan.cls ? `${derived.plan.cls.name} ${character.level}` : 'Sem classe'}
              {derived.plan.species ? ` · ${derived.plan.species.name}` : ''}
            </p>
            <div className="summary-stats">
              <div>
                <span>CA</span>
                <strong>{derived.ac.value}</strong>
              </div>
              <div>
                <span>PV</span>
                <strong>{derived.hp}</strong>
              </div>
              <div>
                <span>Vel.</span>
                <strong>{derived.speed}</strong>
              </div>
              <div>
                <span>Prof.</span>
                <strong>{formatBonus(derived.proficiencyBonus)}</strong>
              </div>
            </div>
            <div className="summary-abilities">
              {ABILITIES.map((a) => (
                <div key={a} title={ABILITY_LABEL[a]}>
                  <span>{a}</span>
                  <strong>{derived.scores[a].total}</strong>
                  <small>{formatBonus(derived.scores[a].mod)}</small>
                </div>
              ))}
            </div>
            <h3>Pendências</h3>
            {required.length === 0 ? (
              <p className="ok-text">Tudo certo! Veja a ficha completa.</p>
            ) : (
              <ul className="issue-list">
                {required.slice(0, 8).map((issue, i) => (
                  <li key={i}>
                    <button type="button" className="link" onClick={() => goStep(issue.step)}>
                      {STEPS.find((s) => s.id === issue.step)?.label}
                    </button>
                    <span>{issue.message}</span>
                  </li>
                ))}
                {required.length > 8 && <li className="muted">e mais {required.length - 8}…</li>}
              </ul>
            )}
          </aside>
        )}
      </div>

      <footer className="builder-foot no-print">
        <button type="button" className="btn btn-ghost" disabled={index <= 0} onClick={() => goStep(ORDER[index - 1]!)}>
          ← Anterior
        </button>
        <span className="muted">
          {index + 1} de {ORDER.length}
        </span>
        <button type="button" className="btn" disabled={index >= ORDER.length - 1} onClick={() => goStep(ORDER[index + 1]!)}>
          {ORDER[index + 1] === 'sheet' ? 'Ver ficha →' : 'Próximo →'}
        </button>
      </footer>
    </div>
  )
}
