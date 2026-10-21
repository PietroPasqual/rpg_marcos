import type { Catalog, FeatureOption, WeaponData } from '../../api/types'
import { withPicks } from '../../domain/character'
import { classHitPoints, hitDieAverage, hpRollKey, isWeaponProficient, weaponRuleForPlan, type Derived } from '../../domain/derive'
import { ELEMENTAL_AFFINITY_TYPES } from '../../domain/effects'
import { lookup } from '../../domain/lookup'
import type { ClassPlan } from '../../domain/plan'
import { spellPools } from '../../domain/spells'
import { RARE_LANGUAGES, SKILLS, STANDARD_LANGUAGES } from '../../domain/srd'
import { CheckList, Collapsible, Markdown, Notice, OptionCard, Section } from '../ui'
import { FeatSlotEditor } from './FeatSlotEditor'
import type { StepProps } from './types'

function masteryWeapons(cp: ClassPlan, derived: Derived, catalog: Catalog): WeaponData[] {
  const rule = weaponRuleForPlan(derived.plan)
  const base = catalog.weapons.filter((w) => (cp.slug === 'barbarian' ? w.range_type === 'Melee' : true))
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

function ClassChoices({ cp, character, derived, catalog, change }: StepProps & { cp: ClassPlan }) {
  const { plan } = derived
  const { picks, cls } = cp
  const multi = plan.classes.length > 1
  const look = lookup(catalog)
  const patch = (p: Parameters<typeof withPicks>[2]) => change((c) => withPicks(c, cp.index, p))

  // Perícias já concedidas por espécie, antecedente ou outras classes não podem ser escolhidas de novo.
  const granted = new Set([
    ...(plan.background?.skill_proficiencies ?? []),
    ...(character.speciesChoice.skill ? [character.speciesChoice.skill] : []),
    ...plan.classes.filter((o) => o.index !== cp.index).flatMap((o) => o.picks.classSkills),
  ])
  const proficientSkills = derived.skills.filter((s) => s.level !== 'none' && s.level !== 'half').map((s) => s.name)
  const otherExpertise = new Set(plan.classes.filter((o) => o.index !== cp.index).flatMap((o) => o.picks.expertise))
  const expertiseOptions = SKILLS.filter((s) => proficientSkills.includes(s.name) && !otherExpertise.has(s.name) && (!cp.expertise.restrictTo || cp.expertise.restrictTo.includes(s.name)))
  const styleAlt = cp.styleAlternative
  const pools = spellPools(picks, cp, catalog)
  const featureOptions = (category: string) => catalog.featureOptions.filter((o) => o.parent_class_slug === cls.slug && o.category === category)
  const invocations = featureOptions('Eldritch Invocation')
  const metamagic = featureOptions('Metamagic')
  const selectedDescriptions = (slugs: string[]) => slugs.map((s) => look.options.get(s)).filter((o): o is FeatureOption => !!o)
  const toolCount = cp.toolChoices.reduce((sum, c) => sum + c.count, 0)
  const hasStyleSlot = plan.featSlots.some((s) => s.classSlug === (cp.index === 0 ? null : cp.slug) && s.base === 'fighting-style')
  const title = multi ? ` de ${cls.name} (nível ${cp.level})` : ''

  return (
    <>
      <Section title={`Perícias${multi ? ` de ${cls.name}` : ' da classe'}`} count={{ current: picks.classSkills.length, needed: cp.skillCount }} hint="Perícias que você já recebeu da espécie, do antecedente ou de outra classe aparecem desabilitadas.">
        {cp.skillCount === 0 ? (
          <p className="muted">{cls.name} não concede perícias ao ser uma classe adicional.</p>
        ) : (
          <CheckList
            columns
            limit={cp.skillCount}
            selected={picks.classSkills}
            onChange={(classSkills) => patch({ classSkills })}
            items={SKILLS.filter((s) => cp.skillOptions.includes(s.name)).map((s) => ({
              value: s.name,
              label: s.name,
              hint: s.label,
              disabled: granted.has(s.name),
              disabledReason: 'Já concedida por outra fonte',
            }))}
          />
        )}
      </Section>

      {toolCount > 0 && (
        <Section title={`Ferramentas${title}`} count={{ current: picks.classTools.length, needed: toolCount }} hint={cp.toolChoices.map((c) => c.label).join('; ')}>
          <CheckList columns limit={toolCount} selected={picks.classTools} onChange={(classTools) => patch({ classTools })} items={cp.toolChoices[0]!.choose_from.map((slug) => ({ value: slug, label: look.tools.get(slug)?.name ?? slug }))} />
        </Section>
      )}

      {cp.expertise.count > 0 && (
        <Section title={`Especialização${title}`} count={{ current: picks.expertise.length, needed: cp.expertise.count }} hint="Você dobra o bônus de proficiência nestas perícias. Só é possível escolher perícias em que você já tem proficiência.">
          <CheckList columns limit={cp.expertise.count} selected={picks.expertise} onChange={(expertise) => patch({ expertise })} items={expertiseOptions.map((s) => ({ value: s.name, label: s.name, hint: s.label }))} />
        </Section>
      )}

      {cp.orderOptions.length > 0 && (
        <Section title={`${cp.orderFeature ?? 'Ordem'}${title}`}>
          <div className="card-grid">
            {cp.orderOptions.map((o) => (
              <OptionCard key={o.slug} selected={picks.classOrder === o.slug} onClick={() => patch({ classOrder: o.slug })} title={o.name}>
                <span className="option-text">{o.text}</span>
              </OptionCard>
            ))}
          </div>
        </Section>
      )}

      {styleAlt && hasStyleSlot && (
        <Section title={`Estilo de Luta${title}`} hint="Você escolhe um talento de Estilo de Luta ou a opção alternativa da classe.">
          <div className="segmented" role="group" aria-label="Tipo de estilo de luta">
            <button type="button" aria-pressed={picks.styleOption === 'feat'} onClick={() => patch({ styleOption: 'feat', styleCantrips: [] })}>
              Talento de Estilo de Luta
            </button>
            <button type="button" aria-pressed={picks.styleOption === styleAlt} onClick={() => patch({ styleOption: styleAlt })}>
              {styleAlt === 'blessed-warrior' ? 'Guerreiro Abençoado' : 'Guerreiro Druídico'}
            </button>
          </div>
          {picks.styleOption === styleAlt && (
            <>
              <p className="hint">Você aprende 2 truques de {styleAlt === 'blessed-warrior' ? 'Cleric' : 'Druid'}.</p>
              <CheckList columns limit={2} selected={picks.styleCantrips} onChange={(styleCantrips) => patch({ styleCantrips })} items={pools.style.map((s) => ({ value: s.slug, label: s.name, hint: s.school }))} />
            </>
          )}
        </Section>
      )}

      {cp.masteryCount > 0 && (
        <Section title={`Maestria de Arma${title}`} count={{ current: picks.masteries.length, needed: cp.masteryCount }} hint="Escolha as armas cujas propriedades de maestria você sabe usar. Você pode trocar após um Descanso Longo.">
          <CheckList columns limit={cp.masteryCount} selected={picks.masteries} onChange={(masteries) => patch({ masteries })} items={masteryWeapons(cp, derived, catalog).map((w) => ({ value: w.slug, label: w.name, hint: w.mastery_name }))} />
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

      {cp.invocationCount > 0 && (
        <Section title={`Invocações Místicas${title}`} count={{ current: picks.invocations.length, needed: cp.invocationCount }} hint="Invocações com pré-requisito de nível aparecem desabilitadas até você alcançá-lo.">
          <CheckList columns limit={cp.invocationCount} selected={picks.invocations} onChange={(sel) => patch({ invocations: sel })} items={optionItems(invocations, cp.level)} />
          {picks.invocations.length > 0 && (
            <Collapsible title="Descrição das invocações escolhidas">
              {selectedDescriptions(picks.invocations).map((o) => (
                <Markdown key={o.slug}>{`**${o.name}.** ${o.description}`}</Markdown>
              ))}
            </Collapsible>
          )}
        </Section>
      )}

      {cp.metamagicCount > 0 && (
        <Section title={`Metamagia${title}`} count={{ current: picks.metamagic.length, needed: cp.metamagicCount }}>
          <CheckList columns limit={cp.metamagicCount} selected={picks.metamagic} onChange={(sel) => patch({ metamagic: sel })} items={optionItems(metamagic, cp.level)} />
          {picks.metamagic.length > 0 && (
            <Collapsible title="Descrição das opções escolhidas">
              {selectedDescriptions(picks.metamagic).map((o) => (
                <Markdown key={o.slug}>{`**${o.name}** (${o.cost_text ?? ''}). ${o.description}`}</Markdown>
              ))}
            </Collapsible>
          )}
        </Section>
      )}

      {cls.slug === 'sorcerer' && cp.subclass?.slug === 'draconic-sorcery' && cp.level >= 6 && (
        <Section title="Afinidade Elemental" hint="Escolha o tipo de dano: você tem resistência a ele e soma Carisma ao dano das suas magias desse tipo.">
          <div className="segmented" role="group" aria-label="Tipo de dano da Afinidade Elemental">
            {ELEMENTAL_AFFINITY_TYPES.map((type) => (
              <button key={type} type="button" aria-pressed={character.elementalAffinity === type} onClick={() => change((c) => ({ ...c, elementalAffinity: type }))}>
                {type}
              </button>
            ))}
          </div>
        </Section>
      )}
    </>
  )
}

function HitPointsSection({ character, derived, change }: StepProps) {
  const { plan } = derived
  const conMod = derived.scores.CON.mod
  const manual = character.hpMode === 'manual'
  const roll = (die: number) => 1 + Math.floor(Math.random() * die)
  const levels = plan.classes.flatMap((cp) => {
    const die = cp.hitDie
    return Array.from({ length: cp.level }, (_, i) => ({ slug: cp.slug, name: cp.cls.name, level: i + 1, die, fixed: cp.index === 0 && i === 0 }))
  })
  const setRoll = (slug: string, level: number, value: number | null) =>
    change((c) => {
      const hpRolls = { ...c.hpRolls }
      if (value === null) delete hpRolls[hpRollKey(slug, level)]
      else hpRolls[hpRollKey(slug, level)] = value
      return { ...c, hpRolls }
    })
  const rollAll = () =>
    change((c) => ({
      ...c,
      hpMode: 'manual',
      hpRolls: Object.fromEntries(levels.filter((l) => !l.fixed).map((l) => [hpRollKey(l.slug, l.level), roll(l.die)])),
    }))

  return (
    <Section title="Pontos de vida" hint="O 1º nível da classe inicial sempre dá o dado máximo. Nos demais níveis use o valor médio (fixo) ou rolle o dado de vida e registre o resultado.">
      <div className="segmented" role="group" aria-label="Como calcular os pontos de vida">
        <button type="button" aria-pressed={!manual} onClick={() => change((c) => ({ ...c, hpMode: 'average' }))}>
          Valor médio
        </button>
        <button type="button" aria-pressed={manual} onClick={() => change((c) => ({ ...c, hpMode: 'manual' }))}>
          Rolar ou digitar
        </button>
      </div>
      <p className="muted">
        Vida das classes (com Constituição): <strong>{classHitPoints(character, plan, conMod)}</strong> · Total na ficha: <strong>{derived.hp}</strong> (inclui bônus de espécie e talentos)
      </p>
      {manual && (
        <>
          <p>
            <button type="button" className="btn btn-sm" onClick={rollAll}>
              Rolar todos os dados
            </button>{' '}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => change((c) => ({ ...c, hpRolls: {} }))}>
              Limpar (usar média)
            </button>
          </p>
          <div className="table-scroll">
            <table className="hp-table">
              <thead>
                <tr>
                  <th>Classe e nível</th>
                  <th>Dado</th>
                  <th>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {levels.map((l) => {
                  const value = character.hpRolls[hpRollKey(l.slug, l.level)]
                  return (
                    <tr key={`${l.slug}-${l.level}`}>
                      <th scope="row">
                        {l.name} {l.level}
                      </th>
                      <td>d{l.die}</td>
                      <td>
                        {l.fixed ? (
                          <span className="muted">{l.die} (máximo)</span>
                        ) : (
                          <span className="hp-input">
                            <input
                              type="number"
                              min={1}
                              max={l.die}
                              placeholder={`${hitDieAverage(l.die)} (média)`}
                              aria-label={`Dado de vida de ${l.name} no nível ${l.level}`}
                              value={value ?? ''}
                              onChange={(e) => setRoll(l.slug, l.level, e.target.value === '' ? null : Math.min(l.die, Math.max(1, Number(e.target.value) || 1)))}
                            />
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRoll(l.slug, l.level, roll(l.die))}>
                              Rolar
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Section>
  )
}

export function ChoicesStep(props: StepProps) {
  const { character, derived, catalog, change } = props
  const { plan } = derived
  if (!plan.cls) return <Notice>Escolha uma classe na primeira etapa para ver as escolhas dela.</Notice>
  const multi = plan.classes.length > 1
  const languageItems = [...STANDARD_LANGUAGES, ...RARE_LANGUAGES].map((l) => ({ value: l, label: l, hint: RARE_LANGUAGES.includes(l) ? 'rara' : undefined }))

  return (
    <div className="step">
      <h2>Escolhas de {plan.classes.map((c) => c.cls.name).join(' e ')}</h2>
      <p className="lead">Aqui ficam as decisões que dependem da sua classe e do seu nível. Cada seção mostra quantas escolhas faltam.</p>

      {plan.classes.map((cp) => (
        <div key={cp.slug} className="class-block">
          {multi && <h3 className="class-block-title">{cp.cls.name} · nível {cp.level}</h3>}
          <ClassChoices {...props} cp={cp} />
        </div>
      ))}

      <Section title="Idiomas" count={{ current: character.languages.length, needed: plan.languageCount }} hint="Todo personagem fala Common. Escolha os outros idiomas da lista.">
        <CheckList columns limit={plan.languageCount} selected={character.languages} onChange={(languages) => change((c) => ({ ...c, languages }))} items={languageItems} />
      </Section>

      <HitPointsSection {...props} />

      <Section title="Talentos e aumentos de atributo">
        {plan.featSlots.length === 0 && <p className="muted">Escolha antecedente e espécie para ver os talentos que você recebe.</p>}
        {plan.featSlots.map((slot) => {
          const owner = plan.classes.find((c) => c.slug === (slot.classSlug ?? plan.classes[0]?.slug))
          const hiddenByStyle = slot.base === 'fighting-style' && owner?.styleAlternative && owner.picks.styleOption === owner.styleAlternative
          if (hiddenByStyle) return null
          return <FeatSlotEditor key={slot.key} slot={slot} character={character} derived={derived} catalog={catalog} change={change} />
        })}
      </Section>
    </div>
  )
}
