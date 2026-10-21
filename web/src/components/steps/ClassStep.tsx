import type { ClassData } from '../../api/types'
import { addClass, removeClass, selectClass, setClassLevel } from '../../domain/actions'
import { withPicks } from '../../domain/character'
import { meetsPrimary, primaryRequirement } from '../../domain/multiclass'
import type { ClassPlan } from '../../domain/plan'
import { ABILITIES, ABILITY_LABEL, MAX_LEVEL } from '../../domain/srd'
import { Chip, Collapsible, Markdown, Notice, OptionCard, Section } from '../ui'
import type { StepProps } from './types'

const requirementText = (c: ClassData) => c.primary_abilities.map((a) => ABILITY_LABEL[a]).join(c.primary_ability_logic === 'AND' ? ' e ' : ' ou ')

function ClassSummary({ cp }: { cp: ClassPlan }) {
  const { cls } = cp
  return (
    <>
      <dl className="facts">
        <dt>Dado de vida</dt>
        <dd>{cls.hit_point_die}</dd>
        <dt>Atributo principal</dt>
        <dd>{requirementText(cls)}</dd>
        {cp.index === 0 ? (
          <>
            <dt>Salvaguardas</dt>
            <dd>{cls.saving_throw_proficiencies.map((a) => ABILITY_LABEL[a]).join(', ')}</dd>
            <dt>Perícias</dt>
            <dd>Escolha {cls.skill_choices_count}</dd>
            <dt>Armas</dt>
            <dd>{cls.weapon_proficiencies.join('; ') || '—'}</dd>
            <dt>Armaduras</dt>
            <dd>{cls.armor_training.join('; ') || 'Nenhuma'}</dd>
            {cls.tool_proficiencies.length > 0 && (
              <>
                <dt>Ferramentas</dt>
                <dd>{cls.tool_proficiencies.join('; ')}</dd>
              </>
            )}
          </>
        ) : (
          <>
            <dt>Ao entrar na classe</dt>
            <dd>{cls.multiclassing.proficiencies_gained.description[0] ?? 'Apenas o dado de vida.'}</dd>
          </>
        )}
      </dl>
      <h4>Características até o nível {cp.level}</h4>
      <div className="stack">
        {cls.features
          .filter((f) => f.level <= cp.level)
          .map((f) => (
            <Collapsible key={f.slug + f.level} title={f.name} meta={`Nível ${f.level}`}>
              <Markdown>{f.description}</Markdown>
            </Collapsible>
          ))}
      </div>
    </>
  )
}

export function ClassStep({ character, derived, catalog, change }: StepProps) {
  const { plan } = derived
  const multi = plan.classes.length > 1
  const totals = Object.fromEntries(ABILITIES.map((a) => [a, derived.scores[a].total])) as Record<(typeof ABILITIES)[number], number>
  const taken = new Set(plan.classes.map((c) => c.slug))
  const available = catalog.classes.filter((c) => !taken.has(c.slug))
  const full = plan.level >= MAX_LEVEL

  return (
    <div className="step">
      <h2>Escolha sua classe</h2>
      <p className="lead">A classe define o que seu personagem faz de melhor: seus dados de vida, perícias, equipamento e poderes ao longo dos níveis.</p>

      <div className="card-grid">
        {catalog.classes.map((c) => (
          <OptionCard
            key={c.slug}
            selected={character.classSlug === c.slug}
            onClick={() => change((ch) => selectClass(ch, c.slug, catalog))}
            title={c.name}
            subtitle={`${c.hit_point_die} · ${requirementText(c)}`}
          >
            <span className="chips">
              {c.spellcasting_ability ? <Chip tone="accent">Conjurador</Chip> : <Chip tone="muted">Marcial</Chip>}
              {c.has_weapon_mastery && <Chip>Maestria de arma</Chip>}
            </span>
          </OptionCard>
        ))}
      </div>

      {plan.classes.length > 0 && (
        <Section
          title="Níveis"
          hint="Novos personagens costumam começar no nível 1. Se a mesa começa em um nível mais alto, ajuste aqui: o assistente liberará as escolhas de cada nível. Com várias classes, o nível total (máximo 20) é a soma dos níveis."
        >
          <ul className="class-levels">
            {plan.classes.map((cp) => (
              <li key={cp.slug} className="class-level">
                <strong className="class-level-name">{cp.cls.name}</strong>
                <input
                  type="range"
                  min={1}
                  max={MAX_LEVEL}
                  value={cp.level}
                  aria-label={`Nível de ${cp.cls.name}`}
                  onChange={(e) => change((c) => setClassLevel(c, cp.index, Number(e.target.value)))}
                />
                <input
                  type="number"
                  min={1}
                  max={MAX_LEVEL}
                  value={cp.level}
                  aria-label={`Nível de ${cp.cls.name} (número)`}
                  className="level-number"
                  onChange={(e) => change((c) => setClassLevel(c, cp.index, Number(e.target.value)))}
                />
                {cp.index > 0 && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => change((c) => removeClass(c, cp.index))}>
                    Remover
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="muted">
            Nível do personagem: <strong>{plan.level}</strong> · Bônus de proficiência +{plan.proficiencyBonus}
            {multi && <> · Dados de vida: {derived.hitDice}</>}
          </p>
        </Section>
      )}

      {plan.cls && (
        <Section
          title="Multiclasse"
          hint="Ao ganhar um nível em outra classe você recebe as características dela, mas só algumas proficiências. Exige 13 ou mais no atributo principal da classe atual e da nova."
        >
          {available.length === 0 ? (
            <p className="muted">Você já tem todas as classes.</p>
          ) : (
            <div className="card-grid card-grid-sm">
              {available.map((c) => {
                const ok = meetsPrimary(c, totals)
                return (
                  <OptionCard key={c.slug} selected={false} disabled={full} onClick={() => change((ch) => addClass(ch, c.slug))} title={`+ ${c.name}`} subtitle={`Exige ${primaryRequirement(c)}`}>
                    {ok ? <Chip tone="good">Atributos atendem</Chip> : <Chip tone="warn">Atributo insuficiente hoje</Chip>}
                  </OptionCard>
                )
              })}
            </div>
          )}
          {full && <Notice>O personagem já está no nível 20: reduza o nível de uma classe para adicionar outra.</Notice>}
          {multi &&
            plan.classes.some((cp) => !meetsPrimary(cp.cls, totals)) && (
              <Notice tone="warn">
                Seus atributos atuais não atendem ao requisito de multiclasse de {plan.classes.filter((cp) => !meetsPrimary(cp.cls, totals)).map((cp) => cp.cls.name).join(', ')}. Ajuste na etapa “Atributos”.
              </Notice>
            )}
        </Section>
      )}

      {plan.classes
        .filter((cp) => cp.needsSubclass)
        .map((cp) => (
          <Section key={cp.slug} title={`Subclasse${multi ? ` de ${cp.cls.name}` : ''}`} hint={`A partir do nível ${cp.cls.subclass_unlock_level} ${cp.cls.name} escolhe uma subclasse.`}>
            <div className="card-grid">
              {cp.subclassOptions.map((s) => (
                <OptionCard key={s.slug} selected={cp.picks.subclassSlug === s.slug} onClick={() => change((c) => withPicks(c, cp.index, { subclassSlug: s.slug }))} title={s.name} subtitle={`${s.features.length} características`} />
              ))}
            </div>
            {cp.subclass && (
              <div className="stack">
                {cp.subclass.features
                  .filter((f) => f.level <= cp.level)
                  .map((f) => (
                    <Collapsible key={f.slug + f.level} title={f.name} meta={`Nível ${f.level}`}>
                      <Markdown>{f.description}</Markdown>
                    </Collapsible>
                  ))}
              </div>
            )}
          </Section>
        ))}

      {plan.classes.map((cp) => (
        <Section key={cp.slug} title={`${cp.cls.name}: resumo`}>
          <ClassSummary cp={cp} />
        </Section>
      ))}
    </div>
  )
}
