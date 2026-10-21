import { selectClass, setLevel } from '../../domain/actions'
import { ABILITY_LABEL, MAX_LEVEL } from '../../domain/srd'
import { Chip, Collapsible, Markdown, OptionCard, Section } from '../ui'
import type { StepProps } from './types'

export function ClassStep({ character, derived, catalog, change }: StepProps) {
  const { plan } = derived
  const cls = plan.cls

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
            subtitle={`${c.hit_point_die} · ${c.primary_abilities.map((a) => ABILITY_LABEL[a]).join(c.primary_ability_logic === 'AND' ? ' e ' : ' ou ')}`}
          >
            <span className="chips">
              {c.spellcasting_ability ? <Chip tone="accent">Conjurador</Chip> : <Chip tone="muted">Marcial</Chip>}
              {c.has_weapon_mastery && <Chip>Maestria de arma</Chip>}
            </span>
          </OptionCard>
        ))}
      </div>

      <Section title="Nível" hint="Novos personagens costumam começar no nível 1. Se a mesa começa em um nível mais alto, ajuste aqui: o assistente liberará as escolhas de cada nível.">
        <div className="level-row">
          <input
            type="range"
            min={1}
            max={MAX_LEVEL}
            value={character.level}
            aria-label="Nível do personagem"
            onChange={(e) => change((c) => setLevel(c, Number(e.target.value)))}
          />
          <input
            type="number"
            min={1}
            max={MAX_LEVEL}
            value={character.level}
            aria-label="Nível (número)"
            className="level-number"
            onChange={(e) => change((c) => setLevel(c, Number(e.target.value)))}
          />
          <span className="muted">Bônus de proficiência +{plan.proficiencyBonus}</span>
        </div>
      </Section>

      {cls && plan.needsSubclass && (
        <Section title="Subclasse" hint={`A partir do nível ${cls.subclass_unlock_level} ${cls.name} escolhe uma subclasse.`}>
          <div className="card-grid">
            {plan.subclassOptions.map((s) => (
              <OptionCard key={s.slug} selected={character.subclassSlug === s.slug} onClick={() => change((c) => ({ ...c, subclassSlug: s.slug }))} title={s.name} subtitle={`${s.features.length} características`} />
            ))}
          </div>
          {plan.subclass && (
            <div className="stack">
              {plan.subclass.features
                .filter((f) => f.level <= plan.level)
                .map((f) => (
                  <Collapsible key={f.slug + f.level} title={f.name} meta={`Nível ${f.level}`}>
                    <Markdown>{f.description}</Markdown>
                  </Collapsible>
                ))}
            </div>
          )}
        </Section>
      )}

      {cls && (
        <Section title={`${cls.name}: resumo`}>
          <dl className="facts">
            <dt>Dado de vida</dt>
            <dd>{cls.hit_point_die}</dd>
            <dt>Atributo principal</dt>
            <dd>{cls.primary_abilities.map((a) => ABILITY_LABEL[a]).join(cls.primary_ability_logic === 'AND' ? ' e ' : ' ou ')}</dd>
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
          </dl>
          <h4>Características até o nível {plan.level}</h4>
          <div className="stack">
            {cls.features
              .filter((f) => f.level <= plan.level)
              .map((f) => (
                <Collapsible key={f.slug + f.level} title={f.name} meta={`Nível ${f.level}`}>
                  <Markdown>{f.description}</Markdown>
                </Collapsible>
              ))}
          </div>
        </Section>
      )}
    </div>
  )
}
