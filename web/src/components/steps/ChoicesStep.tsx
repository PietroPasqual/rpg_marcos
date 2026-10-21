import type { Catalog, FeatureOption, WeaponData } from '../../api/types'
import type { Character } from '../../domain/character'
import { isWeaponProficient, weaponRuleFor, type Derived } from '../../domain/derive'
import { lookup } from '../../domain/lookup'
import { spellPools } from '../../domain/spells'
import { RARE_LANGUAGES, SKILLS, STANDARD_LANGUAGES } from '../../domain/srd'
import { CheckList, Collapsible, Markdown, Notice, OptionCard, Section } from '../ui'
import { FeatSlotEditor } from './FeatSlotEditor'
import type { StepProps } from './types'

function masteryWeapons(character: Character, derived: Derived, catalog: Catalog): WeaponData[] {
  const slug = derived.plan.cls?.slug
  const rule = weaponRuleFor(derived.plan.cls?.weapon_proficiencies ?? [], character.classOrder)
  const base = catalog.weapons.filter((w) => (slug === 'barbarian' ? w.range_type === 'Melee' : true))
  return base.filter((w) => isWeaponProficient(w, rule)).sort((a, b) => a.name.localeCompare(b.name))
}

function optionItems(options: FeatureOption[], level: number) {
  return options.map((o) => ({
    value: o.slug,
    label: o.name,
    hint: o.cost_text ?? o.prerequisite_text ?? undefined,
    disabled: o.level_prerequisite > level,
    disabledReason: `Exige nível ${o.level_prerequisite} de ${o.parent_class_slug}`,
  }))
}

export function ChoicesStep({ character, derived, catalog, change }: StepProps) {
  const { plan } = derived
  const cls = plan.cls
  const look = lookup(catalog)
  if (!cls) return <Notice>Escolha uma classe na primeira etapa para ver as escolhas dela.</Notice>

  const granted = new Set([...(plan.background?.skill_proficiencies ?? []), ...(character.speciesChoice.skill ? [character.speciesChoice.skill] : [])])
  const proficientSkills = derived.skills.filter((s) => s.level !== 'none' && s.level !== 'half').map((s) => s.name)
  const expertiseOptions = SKILLS.filter((s) => proficientSkills.includes(s.name) && (!plan.expertise.restrictTo || plan.expertise.restrictTo.includes(s.name)))
  const styleOptions = plan.styleAlternative
  const pools = spellPools(character, plan, catalog)
  const featureOptions = (category: string) => catalog.featureOptions.filter((o) => o.parent_class_slug === cls.slug && o.category === category)
  const invocations = featureOptions('Eldritch Invocation')
  const metamagic = featureOptions('Metamagic')
  const selectedDescriptions = (slugs: string[]) => slugs.map((s) => look.options.get(s)).filter((o): o is FeatureOption => !!o)
  const languageItems = [...STANDARD_LANGUAGES, ...RARE_LANGUAGES].map((l) => ({ value: l, label: l, hint: RARE_LANGUAGES.includes(l) ? 'rara' : undefined }))
  const toolCount = plan.toolChoices.reduce((sum, c) => sum + c.count, 0)

  return (
    <div className="step">
      <h2>Escolhas de {cls.name}</h2>
      <p className="lead">Aqui ficam as decisões que dependem da sua classe e do seu nível. Cada seção mostra quantas escolhas faltam.</p>

      <Section title="Perícias da classe" count={{ current: character.classSkills.length, needed: plan.classSkillCount }} hint="Perícias que você já recebeu da espécie ou do antecedente aparecem desabilitadas.">
        <CheckList
          columns
          limit={plan.classSkillCount}
          selected={character.classSkills}
          onChange={(classSkills) => change((c) => ({ ...c, classSkills }))}
          items={SKILLS.filter((s) => plan.classSkillOptions.includes(s.name)).map((s) => ({
            value: s.name,
            label: s.name,
            hint: s.label,
            disabled: granted.has(s.name),
            disabledReason: 'Já concedida pela espécie ou antecedente',
          }))}
        />
      </Section>

      {toolCount > 0 && (
        <Section title="Ferramentas da classe" count={{ current: character.classTools.length, needed: toolCount }} hint={plan.toolChoices.map((c) => c.label).join('; ')}>
          <CheckList
            columns
            limit={toolCount}
            selected={character.classTools}
            onChange={(classTools) => change((c) => ({ ...c, classTools }))}
            items={plan.toolChoices[0]!.choose_from.map((slug) => ({ value: slug, label: look.tools.get(slug)?.name ?? slug }))}
          />
        </Section>
      )}

      {plan.expertise.count > 0 && (
        <Section title="Especialização" count={{ current: character.expertise.length, needed: plan.expertise.count }} hint="Você dobra o bônus de proficiência nestas perícias. Só é possível escolher perícias em que você já tem proficiência.">
          <CheckList columns limit={plan.expertise.count} selected={character.expertise} onChange={(expertise) => change((c) => ({ ...c, expertise }))} items={expertiseOptions.map((s) => ({ value: s.name, label: s.name, hint: s.label }))} />
        </Section>
      )}

      <Section title="Idiomas" count={{ current: character.languages.length, needed: plan.languageCount }} hint="Todo personagem fala Common. Escolha os outros idiomas da lista.">
        <CheckList columns limit={plan.languageCount} selected={character.languages} onChange={(languages) => change((c) => ({ ...c, languages }))} items={languageItems} />
      </Section>

      {plan.orderOptions.length > 0 && (
        <Section title={plan.orderFeature ?? 'Ordem'}>
          <div className="card-grid">
            {plan.orderOptions.map((o) => (
              <OptionCard key={o.slug} selected={character.classOrder === o.slug} onClick={() => change((c) => ({ ...c, classOrder: o.slug }))} title={o.name}>
                <span className="option-text">{o.text}</span>
              </OptionCard>
            ))}
          </div>
        </Section>
      )}

      {styleOptions && plan.featSlots.some((s) => s.key === 'fighting-style') && (
        <Section title="Estilo de Luta" hint="Você escolhe um talento de Estilo de Luta ou a opção alternativa da classe.">
          <div className="segmented" role="group" aria-label="Tipo de estilo de luta">
            <button type="button" aria-pressed={character.styleOption === 'feat'} onClick={() => change((c) => ({ ...c, styleOption: 'feat', styleCantrips: [] }))}>
              Talento de Estilo de Luta
            </button>
            <button type="button" aria-pressed={character.styleOption === styleOptions} onClick={() => change((c) => ({ ...c, styleOption: styleOptions }))}>
              {styleOptions === 'blessed-warrior' ? 'Guerreiro Abençoado' : 'Guerreiro Druídico'}
            </button>
          </div>
          {character.styleOption === styleOptions && (
            <>
              <p className="hint">Você aprende 2 truques de {styleOptions === 'blessed-warrior' ? 'Cleric' : 'Druid'}.</p>
              <CheckList columns limit={2} selected={character.styleCantrips} onChange={(styleCantrips) => change((c) => ({ ...c, styleCantrips }))} items={pools.style.map((s) => ({ value: s.slug, label: s.name, hint: s.school }))} />
            </>
          )}
        </Section>
      )}

      {plan.masteryCount > 0 && (
        <Section title="Maestria de Arma" count={{ current: character.masteries.length, needed: plan.masteryCount }} hint="Escolha as armas cujas propriedades de maestria você sabe usar. Você pode trocar após um Descanso Longo.">
          <CheckList
            columns
            limit={plan.masteryCount}
            selected={character.masteries}
            onChange={(masteries) => change((c) => ({ ...c, masteries }))}
            items={masteryWeapons(character, derived, catalog).map((w) => ({ value: w.slug, label: w.name, hint: w.mastery_name }))}
          />
          <Collapsible title="O que cada maestria faz">
            <ul className="plain">
              {catalog.masteries.map((m) => (
                <li key={m.slug}>
                  <strong>{m.name}.</strong> {m.description}
                </li>
              ))}
            </ul>
          </Collapsible>
        </Section>
      )}

      {plan.invocationCount > 0 && (
        <Section title="Invocações Místicas" count={{ current: character.invocations.length, needed: plan.invocationCount }} hint="Invocações com pré-requisito de nível aparecem desabilitadas até você alcançá-lo.">
          <CheckList columns limit={plan.invocationCount} selected={character.invocations} onChange={(invocations) => change((c) => ({ ...c, invocations }))} items={optionItems(invocations, character.level)} />
          {character.invocations.length > 0 && (
            <Collapsible title="Descrição das invocações escolhidas">
              {selectedDescriptions(character.invocations).map((o) => (
                <Markdown key={o.slug}>{`**${o.name}.** ${o.description}`}</Markdown>
              ))}
            </Collapsible>
          )}
        </Section>
      )}

      {plan.metamagicCount > 0 && (
        <Section title="Metamagia" count={{ current: character.metamagic.length, needed: plan.metamagicCount }}>
          <CheckList columns limit={plan.metamagicCount} selected={character.metamagic} onChange={(metamagicSel) => change((c) => ({ ...c, metamagic: metamagicSel }))} items={optionItems(metamagic, character.level)} />
          {character.metamagic.length > 0 && (
            <Collapsible title="Descrição das opções escolhidas">
              {selectedDescriptions(character.metamagic).map((o) => (
                <Markdown key={o.slug}>{`**${o.name}** (${o.cost_text ?? ''}). ${o.description}`}</Markdown>
              ))}
            </Collapsible>
          )}
        </Section>
      )}

      <Section title="Talentos e aumentos de atributo">
        {plan.featSlots.length === 0 && <p className="muted">Escolha antecedente e espécie para ver os talentos que você recebe.</p>}
        {plan.featSlots.map((slot) => {
          const hiddenByStyle = slot.key === 'fighting-style' && plan.styleAlternative && character.styleOption === plan.styleAlternative
          if (hiddenByStyle) return null
          return <FeatSlotEditor key={slot.key} slot={slot} character={character} derived={derived} catalog={catalog} change={change} />
        })}
      </Section>
    </div>
  )
}
