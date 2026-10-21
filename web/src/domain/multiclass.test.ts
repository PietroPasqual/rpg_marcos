import { describe, expect, it } from 'vitest'
import { addClass, removeClass, selectClass, setClassLevel } from './actions'
import { autofill } from './autofill'
import { emptyPicks, newCharacter, normalizeCharacter, totalLevel, type Character } from './character'
import { derive } from './derive'
import { meetsPrimary, multiclassGains } from './multiclass'
import { buildPlan } from './plan'
import { prune } from './prune'
import { requiredIssues, validate } from './validation'
import { build, catalog } from '../test/builders'

const extra = (slug: string, level: number) => ({ slug, level, ...emptyPicks() })
const cls = (slug: string) => catalog.classes.find((c) => c.slug === slug)!

describe('multiclasse: toda dupla de classes pode ser completada', () => {
  for (const first of catalog.classes) {
    it(`${first.name} com cada uma das outras classes`, () => {
      for (const second of catalog.classes) {
        if (second.slug === first.slug) continue
        for (const [a, b] of [
          [1, 1],
          [5, 3],
          [11, 9],
        ] as const) {
          const character = autofill({ ...newCharacter(), level: a }, catalog, { classSlug: first.slug, extraClasses: [{ slug: second.slug, level: b }] })
          const label = `${first.name} ${a} + ${second.name} ${b}`
          expect(totalLevel(character), label).toBe(a + b)
          expect(requiredIssues(validate(character, catalog)), label).toEqual([])
          const d = derive(character, catalog)
          expect(d.hp, label).toBeGreaterThan(0)
          expect(d.plan.level, label).toBe(a + b)
          expect(d.skills.every((s) => Number.isFinite(s.mod)), label).toBe(true)
        }
      }
    })
  }
})

describe('multiclasse: regras', () => {
  it('nível total, bônus de proficiência e dados de vida somam as classes', () => {
    const c = build({ classSlug: 'fighter', level: 3, multiclass: [extra('wizard', 2)] })
    const d = derive(c, catalog)
    expect(d.plan.level).toBe(5)
    expect(d.proficiencyBonus).toBe(3)
    expect(d.hitDice).toBe('3d10 + 2d6')
  })

  it('PV: dado máximo só no 1º nível da classe inicial; as demais usam a média', () => {
    const d = derive(build({ classSlug: 'fighter', level: 1, multiclass: [extra('wizard', 2)] }), catalog)
    // Constituição 14 (+2): Guerreiro 10+2, Mago 2 níveis × (4+2)
    expect(d.hp).toBe(12 + 2 * 6)
  })

  it('espaços de magia combinados usam a tabela de Conjurador Multiclasse', () => {
    const wizardCleric = buildPlan(build({ classSlug: 'wizard', level: 5, multiclass: [extra('cleric', 3)] }), catalog)
    expect(wizardCleric.spellSlots).toEqual({ 1: 4, 2: 3, 3: 3, 4: 2 }) // nível de conjurador 8
    const paladinSorcerer = buildPlan(build({ classSlug: 'paladin', level: 4, multiclass: [extra('sorcerer', 2)] }), catalog)
    expect(paladinSorcerer.spellSlots).toEqual({ 1: 4, 2: 3 }) // 2 (metade de 4) + 2 = nível 4
  })

  it('uma única classe conjuradora usa a própria tabela, e o Bruxo tem espaços de Pacto à parte', () => {
    const fighterWizard = buildPlan(build({ classSlug: 'fighter', level: 3, multiclass: [extra('wizard', 2)] }), catalog)
    expect(fighterWizard.spellSlots).toEqual({ 1: 3 })
    const warlockWizard = buildPlan(build({ classSlug: 'warlock', level: 2, multiclass: [extra('wizard', 3)] }), catalog)
    expect(warlockWizard.spellSlots).toEqual({ 1: 4, 2: 2 })
    expect(warlockWizard.pactSlots).toEqual({ count: 2, level: 1 })
    expect(warlockWizard.maxSpellLevel).toBe(2)
  })

  it('cada classe conjuradora tem a própria lista, CD e ataque', () => {
    const d = derive(build({ classSlug: 'wizard', level: 3, multiclass: [extra('cleric', 2)] }), catalog)
    expect(d.spellcasting?.casters.map((c) => [c.slug, c.ability])).toEqual([
      ['wizard', 'INT'],
      ['cleric', 'WIS'],
    ])
    expect(d.plan.classes[1]!.casting.cantrips).toBeGreaterThan(0)
  })

  it('proficiências: salvaguardas só da classe inicial; armas e armaduras do que a nova classe concede', () => {
    const d = derive(build({ classSlug: 'wizard', level: 2, multiclass: [extra('fighter', 1)] }), catalog)
    expect(d.saves.filter((s) => s.proficient).map((s) => s.ability).sort()).toEqual(['INT', 'WIS'])
    expect(d.proficiencies.armor.sort()).toEqual(['Light armor', 'Medium armor', 'Shields'])
    expect(d.proficiencies.weapons.join(' ')).toContain('Martial weapons (Fighter)')
    const gains = multiclassGains(cls('fighter'))
    expect(gains).toMatchObject({ martial: true, armor: ['Light', 'Medium', 'Shield'], skillCount: 0 })
  })

  it('Ladino e Bardo concedem 1 perícia ao serem classe adicional; Ladino também Thieves’ Tools', () => {
    const rogue = multiclassGains(cls('rogue'))
    expect(rogue.skillCount).toBe(1)
    expect(rogue.skillOptions.sort()).toEqual([...cls('rogue').skill_options].sort())
    expect(rogue.toolNames.join()).toContain('Thieves')
    const bard = multiclassGains(cls('bard'))
    expect(bard.skillOptions).toHaveLength(18)
    expect(bard.toolChoice?.count).toBe(1)
    expect(buildPlan(build({ classSlug: 'fighter', multiclass: [extra('rogue', 1)] }), catalog).classes[1]).toMatchObject({ skillCount: 1 })
  })

  it('pré-requisito: 13 no atributo primário de todas as classes (E exige todos, OU basta um)', () => {
    const totals = { STR: 8, DEX: 13, CON: 10, INT: 15, WIS: 10, CHA: 10 }
    expect(meetsPrimary(cls('fighter'), totals)).toBe(true) // Força OU Destreza
    expect(meetsPrimary(cls('wizard'), totals)).toBe(true)
    expect(meetsPrimary(cls('monk'), totals)).toBe(false) // Destreza E Sabedoria
    const issues = requiredIssues(validate(build({ classSlug: 'wizard', multiclass: [extra('paladin', 1)] }), catalog))
    expect(issues.some((i) => i.step === 'class' && i.message.includes('Paladin'))).toBe(true)
    expect(requiredIssues(validate(build({ classSlug: 'wizard', multiclass: [extra('fighter', 1)] }), catalog)).some((i) => i.message.startsWith('Multiclasse'))).toBe(false)
  })

  it('cada classe tem os próprios aumentos de atributo, sem colidir', () => {
    const plan = buildPlan(build({ classSlug: 'fighter', level: 4, multiclass: [extra('rogue', 4)] }), catalog)
    expect(plan.featSlots.map((s) => s.key)).toEqual(['fighting-style', 'asi-4', 'rogue:asi-4'])
    const rogueSlot = plan.featSlots.find((s) => s.key === 'rogue:asi-4')!
    expect(rogueSlot).toMatchObject({ classSlug: 'rogue', base: 'asi-4' })
  })

  it('adicionar, remover e trocar classes respeita o limite de 20 níveis', () => {
    let c = build({ classSlug: 'fighter', level: 15 })
    c = addClass(c, 'wizard')
    expect(c.multiclass.map((m) => m.slug)).toEqual(['wizard'])
    expect(addClass(c, 'wizard')).toBe(c) // sem repetir
    expect(addClass(c, 'fighter')).toBe(c)
    c = setClassLevel(c, 1, 99)
    expect(totalLevel(c)).toBe(20)
    expect(c.multiclass[0]!.level).toBe(5)
    c = setClassLevel(c, 0, 20)
    expect(c.level).toBe(15) // o nível total nunca passa de 20
    c = removeClass(c, 1)
    expect(c.multiclass).toEqual([])
    c = selectClass(addClass(build({ classSlug: 'fighter' }), 'rogue'), 'rogue', catalog)
    expect(c.classSlug).toBe('rogue')
    expect(c.multiclass).toEqual([]) // a classe escolhida como inicial deixa de ser adicional
  })

  it('prune descarta classes adicionais repetidas, desconhecidas ou acima de 20 níveis', () => {
    const messy = { ...newCharacter(), classSlug: 'fighter', level: 18, multiclass: [extra('fighter', 1), extra('nope', 1), extra('wizard', 9), extra('rogue', 1)] } as Character
    const pruned = prune(messy, catalog)
    expect(pruned.multiclass.map((m) => [m.slug, m.level])).toEqual([['wizard', 2]])
    expect(prune({ ...messy, classSlug: null }, catalog).multiclass).toEqual([])
  })

  it('fichas antigas (sem multiclasse nem PV registrados) continuam válidas', () => {
    const { multiclass: _m, hpMode: _h, hpRolls: _r, elementalAffinity: _e, ...old } = newCharacter()
    const loaded = normalizeCharacter({ ...old, classSlug: 'wizard' })!
    expect(loaded).toMatchObject({ multiclass: [], hpMode: 'average', hpRolls: {}, elementalAffinity: null })
  })

  it('Defesa sem Armadura vem só da primeira classe que a concede', () => {
    const scores = { STR: 10, DEX: 14, CON: 16, INT: 8, WIS: 10, CHA: 8 }
    const monkFirst = derive(build({ classSlug: 'monk', multiclass: [extra('barbarian', 1)], baseScores: scores }), catalog)
    expect(monkFirst.ac.value).toBe(10 + 2 + 0) // Sabedoria, mesmo com Constituição maior
    const barbarianFirst = derive(build({ classSlug: 'barbarian', multiclass: [extra('monk', 1)], baseScores: scores }), catalog)
    expect(barbarianFirst.ac.value).toBe(10 + 2 + 3)
  })

  it('Ataque Extra de classes diferentes gera aviso', () => {
    const d = derive(build({ classSlug: 'fighter', level: 5, multiclass: [extra('paladin', 5)] }), catalog)
    expect(d.warnings.some((w) => w.includes('Ataque Extra'))).toBe(true)
  })
})

describe('pontos de vida: média, rolagem e valor manual', () => {
  const base = { classSlug: 'fighter', level: 4 }
  it('média por padrão', () => {
    expect(derive(build(base), catalog).hp).toBe(10 + 2 + 3 * (6 + 2))
  })

  it('modo manual usa o dado registrado de cada nível e ignora o nível 1', () => {
    const d = derive(build({ ...base, hpMode: 'manual', hpRolls: { 'fighter:1': 1, 'fighter:2': 10, 'fighter:3': 1, 'fighter:4': 5 } }), catalog)
    expect(d.hp).toBe(10 + 2 + (10 + 2) + (1 + 2) + (5 + 2))
  })

  it('dado ausente ou fora do intervalo volta para a média, e prune descarta o inválido', () => {
    const c = build({ ...base, hpMode: 'manual', hpRolls: { 'fighter:2': 11, 'fighter:3': 0, 'fighter:9': 3, 'wizard:2': 3 } })
    expect(c.hpRolls).toEqual({})
    expect(derive(c, catalog).hp).toBe(10 + 2 + 3 * 8)
  })

  it('PV por nível nunca é menor que 1', () => {
    const c = build({ classSlug: 'wizard', level: 3, baseScores: { STR: 8, DEX: 13, CON: 3, INT: 15, WIS: 12, CHA: 10 } })
    expect(derive(c, catalog).hp).toBe(Math.max(1, 6 - 4) + 2 * Math.max(1, 4 - 4))
  })

  it('multiclasse: rolagens são por classe e nível', () => {
    const c = build({ classSlug: 'fighter', level: 1, multiclass: [extra('wizard', 2)], hpMode: 'manual', hpRolls: { 'wizard:1': 6, 'wizard:2': 2 } })
    expect(derive(c, catalog).hp).toBe(12 + (6 + 2) + (2 + 2))
  })
})
