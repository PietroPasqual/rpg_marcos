import type { Ability } from '../../api/types'
import { selectBackground, selectSpecies } from '../../domain/actions'
import { ABILITY_LABEL, SKILLS } from '../../domain/srd'
import { Chip, Collapsible, Markdown, Notice, OptionCard, Section, SelectField } from '../ui'
import type { StepProps } from './types'

export function OriginStep({ character, derived, catalog, change }: StepProps) {
  const { plan } = derived
  const { species, background, speciesNeeds: needs } = plan
  const choice = character.speciesChoice
  const asi = character.backgroundAsi
  const abilityOptions = (allowed: Ability[], exclude: Ability | null = null) =>
    allowed.map((a) => ({ value: a, label: ABILITY_LABEL[a], disabled: a === exclude }))
  const toolName = (slug: string) => catalog.tools.find((t) => t.slug === slug)?.name ?? slug

  return (
    <div className="step">
      <h2>Origem do personagem</h2>
      <p className="lead">Sua espécie e seu antecedente contam de onde você vem. Na edição de 2024, é o antecedente (e não a espécie) que aumenta seus atributos.</p>

      <Section title="Espécie">
        <div className="card-grid">
          {catalog.species.map((s) => (
            <OptionCard key={s.slug} selected={character.speciesSlug === s.slug} onClick={() => change((c) => selectSpecies(c, s.slug, catalog))} title={s.name} subtitle={`${s.sizes.join(' ou ')} · ${s.speed_ft} ft`}>
              {s.darkvision_ft ? <Chip>Visão no escuro {s.darkvision_ft} ft</Chip> : null}
            </OptionCard>
          ))}
        </div>

        {species && (
          <>
            <div className="choice-box">
              {needs.lineage && (
                <div>
                  <h4>{species.lineage_table_title ?? 'Linhagem'}</h4>
                  <div className="card-grid card-grid-sm">
                    {species.lineages.map((l) => (
                      <OptionCard key={l.slug} selected={choice.lineage === l.slug} onClick={() => change((c) => ({ ...c, speciesChoice: { ...c.speciesChoice, lineage: l.slug } }))} title={l.name}>
                        <span className="option-text">{l.description}</span>
                      </OptionCard>
                    ))}
                  </div>
                </div>
              )}
              <div className="field-row">
                {needs.size && (
                  <SelectField label="Tamanho" value={choice.size} onChange={(v) => change((c) => ({ ...c, speciesChoice: { ...c.speciesChoice, size: v } }))} options={species.sizes.map((s) => ({ value: s, label: s }))} />
                )}
                {needs.skill && (
                  <SelectField
                    label="Perícia da espécie"
                    value={choice.skill}
                    onChange={(v) => change((c) => ({ ...c, speciesChoice: { ...c.speciesChoice, skill: v } }))}
                    options={needs.skill.map((s) => ({ value: s, label: SKILLS.find((k) => k.name === s)?.label ? `${s} (${SKILLS.find((k) => k.name === s)!.label})` : s, disabled: background?.skill_proficiencies.includes(s) }))}
                  />
                )}
                {needs.spellAbility && choice.lineage && (
                  <SelectField
                    label="Atributo de conjuração da espécie"
                    value={choice.spellAbility}
                    onChange={(v) => change((c) => ({ ...c, speciesChoice: { ...c.speciesChoice, spellAbility: v as Ability | null } }))}
                    options={abilityOptions(['INT', 'WIS', 'CHA'])}
                  />
                )}
              </div>
            </div>
            <div className="stack">
              {species.traits.map((t) => (
                <Collapsible key={t.slug} title={t.name}>
                  <Markdown>{t.description}</Markdown>
                </Collapsible>
              ))}
            </div>
          </>
        )}
      </Section>

      <Section title="Antecedente">
        <div className="card-grid">
          {catalog.backgrounds.map((b) => (
            <OptionCard key={b.slug} selected={character.backgroundSlug === b.slug} onClick={() => change((c) => selectBackground(c, b.slug, catalog))} title={b.name} subtitle={`Talento: ${b.origin_feat_name}`}>
              <span className="option-text">{b.skill_proficiencies.join(' e ')}</span>
            </OptionCard>
          ))}
        </div>

        {background && (
          <div className="choice-box">
            <dl className="facts">
              <dt>Atributos</dt>
              <dd>{background.ability_scores.map((a) => ABILITY_LABEL[a]).join(', ')}</dd>
              <dt>Perícias</dt>
              <dd>{background.skill_proficiencies.join(' e ')}</dd>
              <dt>Ferramenta</dt>
              <dd>{background.tool_slug ? toolName(background.tool_slug) : background.tool_proficiency}</dd>
              <dt>Talento de Origem</dt>
              <dd>{background.origin_feat_name}</dd>
            </dl>

            <h4>Aumentos de atributo do antecedente</h4>
            <div className="segmented" role="group" aria-label="Forma de distribuir os aumentos">
              <button type="button" aria-pressed={asi.mode === 'two-one'} onClick={() => change((c) => ({ ...c, backgroundAsi: { ...c.backgroundAsi, mode: 'two-one' } }))}>
                +2 e +1
              </button>
              <button type="button" aria-pressed={asi.mode === 'one-one-one'} onClick={() => change((c) => ({ ...c, backgroundAsi: { ...c.backgroundAsi, mode: 'one-one-one' } }))}>
                +1, +1 e +1
              </button>
            </div>
            {asi.mode === 'two-one' ? (
              <div className="field-row">
                <SelectField label="+2 em" value={asi.plus2} onChange={(v) => change((c) => ({ ...c, backgroundAsi: { ...c.backgroundAsi, plus2: v as Ability | null } }))} options={abilityOptions(background.ability_scores, asi.plus1)} />
                <SelectField label="+1 em" value={asi.plus1} onChange={(v) => change((c) => ({ ...c, backgroundAsi: { ...c.backgroundAsi, plus1: v as Ability | null } }))} options={abilityOptions(background.ability_scores, asi.plus2)} />
              </div>
            ) : (
              <p className="muted">+1 em {background.ability_scores.map((a) => ABILITY_LABEL[a]).join(', ')}.</p>
            )}

            {background.tool_choose_from.length > 0 && (
              <SelectField
                label={`Ferramenta (${background.tool_proficiency.replace(/^Choose one kind of /i, '')})`}
                value={character.backgroundTool}
                onChange={(v) => change((c) => ({ ...c, backgroundTool: v }))}
                options={background.tool_choose_from.map((s) => ({ value: s, label: toolName(s) }))}
              />
            )}
            {background.description && <Markdown>{background.description}</Markdown>}
          </div>
        )}
        {!background && <Notice>Escolha um antecedente para distribuir os aumentos de atributo.</Notice>}
      </Section>
    </div>
  )
}
