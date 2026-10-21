import { describe, expect, it } from 'vitest'
import { autofill } from './autofill'
import { newCharacter, normalizeCharacter } from './character'
import { abilityMod, armorTrainingFor, derive, weaponRuleFor } from './derive'
import { addItem, applyEquipmentOption, setEquipped } from './equipment'
import { proficiencyBonusFor, buildPlan } from './plan'
import { prune } from './prune'
import { pointBuyCost, requiredIssues, validate } from './validation'
import { build, catalog, completeWizard } from '../test/builders'

describe('regras básicas', () => {
  it('calcula modificadores e bônus de proficiência', () => {
    expect([8, 9, 10, 11, 12, 15, 20].map(abilityMod)).toEqual([-1, -1, 0, 0, 1, 2, 5])
    expect([1, 4, 5, 8, 9, 12, 13, 16, 17, 20].map(proficiencyBonusFor)).toEqual([2, 2, 3, 3, 4, 4, 5, 5, 6, 6])
  })

  it('compra de pontos custa o previsto', () => {
    const scores = { STR: 15, DEX: 15, CON: 15, INT: 8, WIS: 8, CHA: 8 }
    expect(pointBuyCost(scores)).toBe(27)
    expect(pointBuyCost({ ...scores, INT: 9 })).toBe(28)
  })

  it('interpreta proficiências de arma e armadura das classes', () => {
    const rogue = weaponRuleFor(['Simple weapons and Martial weapons that have the Finesse or Light property'], null)
    expect(rogue).toEqual({ simple: true, martial: 'properties', martialProperties: ['Finesse', 'Light'] })
    expect(weaponRuleFor(['Simple weapons'], 'protector').martial).toBe('all')
    expect(weaponRuleFor(['Simple and Martial weapons'], null).martial).toBe('all')
    expect([...armorTrainingFor(['Light and Medium armor and Shields'], null)].sort()).toEqual(['Light', 'Medium', 'Shield'])
    expect(armorTrainingFor(['Light armor'], 'protector').has('Heavy')).toBe(true)
  })
})

describe('Mago humano de nível 1', () => {
  const wizard = completeWizard()
  const d = derive(wizard, catalog)

  it('aplica os bônus do antecedente aos atributos da Matriz Padrão', () => {
    expect(d.scores.INT).toMatchObject({ base: 15, bonus: 2, total: 17, mod: 3 })
    expect(d.scores.CON).toMatchObject({ base: 14, bonus: 1, total: 15, mod: 2 })
    expect(d.scores.DEX.total).toBe(13)
  })

  it('calcula PV, CA, iniciativa e velocidade', () => {
    expect(d.hp).toBe(6 + 2)
    expect(d.ac.value).toBe(11)
    expect(d.initiative).toBe(1 + 2) // Destreza + bônus de proficiência do talento Alert
    expect(d.speed).toBe(30)
  })

  it('calcula salvaguardas e perícias', () => {
    expect(d.saves.find((s) => s.ability === 'INT')).toMatchObject({ proficient: true, mod: 5 })
    expect(d.saves.find((s) => s.ability === 'WIS')).toMatchObject({ proficient: true, mod: 3 })
    expect(d.saves.find((s) => s.ability === 'STR')).toMatchObject({ proficient: false, mod: -1 })
    const skill = (name: string) => d.skills.find((s) => s.name === name)!
    expect(skill('Arcana')).toMatchObject({ level: 'proficient', mod: 5 })
    expect(skill('Perception')).toMatchObject({ level: 'proficient', mod: 3 })
    expect(skill('Athletics')).toMatchObject({ level: 'none', mod: -1 })
    expect(d.passivePerception).toBe(13)
  })

  it('calcula conjuração, magias e espaços', () => {
    expect(d.spellcasting).toMatchObject({ ability: 'INT', dc: 13, attack: 5 })
    expect(d.spellcasting?.slots).toEqual({ 1: 2 })
    expect(d.plan.casting).toMatchObject({ cantrips: 3, prepared: 4, spellbook: 6 })
    expect(d.spells.filter((s) => s.spell.level === 0)).toHaveLength(5) // 3 do Mago + 2 do Magic Initiate
  })

  it('não tem pendências obrigatórias', () => {
    expect(requiredIssues(validate(wizard, catalog))).toEqual([])
  })

  it('lista idiomas, ouro e peso do equipamento', () => {
    expect(d.languages).toEqual(['Common', 'Elvish', 'Gnomish'])
    expect(d.gold).toBe(5 + 8) // Mago (A) + Sage (A)
    expect(d.carryCapacity).toBe(8 * 15)
  })
})

describe('Mago em níveis maiores', () => {
  it('nível 5 tem espaços, truques, grimório e Scholar', () => {
    const plan = buildPlan(completeWizard(5), catalog)
    expect(plan.casting).toMatchObject({ cantrips: 4, prepared: 9, spellbook: 14, maxSpellLevel: 3, slots: { 1: 4, 2: 3, 3: 2 } })
    expect(plan.expertise).toEqual({ count: 1, restrictTo: ['Arcana', 'History', 'Investigation', 'Medicine', 'Nature', 'Religion'] })
    expect(plan.featSlots.map((s) => s.key)).toEqual(['origin', 'versatile', 'asi-4'])
    expect(plan.needsSubclass).toBe(true)
  })

  it('ao reduzir o nível, descarta escolhas que deixaram de valer', () => {
    const level1 = completeWizard(1)
    const grown = { ...level1, level: 5, spells: { ...level1.spells, spellbook: level1.spells.spellbook, prepared: level1.spells.spellbook } }
    const shrunk = prune({ ...grown, level: 1 }, catalog)
    expect(shrunk.spells.prepared).toHaveLength(4)
    expect(shrunk.feats['asi-4']).toBeUndefined()
  })
})

describe('Bárbaro e Guerreiro', () => {
  const barbarian = () =>
    applyEquipmentOption(
      build({ level: 1, classSlug: 'barbarian', speciesSlug: 'human', backgroundSlug: 'soldier', backgroundAsi: { mode: 'one-one-one', plus2: null, plus1: null }, baseScores: { STR: 15, DEX: 13, CON: 14, INT: 8, WIS: 10, CHA: 12 } }),
      catalog,
      'class',
      'A',
    )

  it('usa Defesa sem Armadura e ataca com Força', () => {
    const d = derive(barbarian(), catalog)
    expect(d.scores.STR.total).toBe(16)
    expect(d.ac.value).toBe(10 + 2 + 2) // 10 + Des(+2 com 14) + Con(+2 com 15)
    expect(d.hp).toBe(12 + 2)
    const axe = d.attacks.find((a) => a.name === 'Greataxe')!
    expect(axe).toMatchObject({ bonus: 3 + 2, damage: '1d12+3', damageType: 'Slashing' })
    expect(d.attacks.find((a) => a.name === 'Handaxe')).toMatchObject({ quantity: 4 })
    expect(d.resources).toContainEqual({ label: 'Rages', value: '2' })
  })

  it('junta a mesma arma de origens diferentes em uma linha e omite "duas mãos" quando o dado é igual', () => {
    const wizard = completeWizard()
    const staffRows = derive(wizard, catalog).attacks.filter((a) => a.name === 'Quarterstaff')
    expect(staffRows).toHaveLength(1)
    expect(staffRows[0]!.quantity).toBe(2)
    const monk = derive(autofill({ ...newCharacter(), level: 5 }, catalog, { classSlug: 'monk' }), catalog)
    expect(monk.attacks.find((a) => a.name === 'Spear')!.damage).toBe('1d8+4')
  })

  it('ganha Movimento Rápido no nível 5', () => {
    expect(derive(build({ classSlug: 'barbarian', level: 5 }), catalog).speed).toBe(40)
  })

  it('Guerreiro com cota de malha, escudo e Defense', () => {
    let fighter = build({ classSlug: 'fighter', speciesSlug: 'human', feats: { 'fighting-style': { slug: 'defense' } } })
    fighter = addItem(addItem(fighter, catalog, 'armor', 'chain-mail'), catalog, 'armor', 'shield')
    for (const item of fighter.inventory) fighter = setEquipped(fighter, catalog, item.id, true)
    const d = derive(fighter, catalog)
    expect(d.ac).toMatchObject({ value: 16 + 2 + 1 })
    expect(d.warnings.some((w) => w.includes('Stealth'))).toBe(true)
    expect(d.warnings.some((w) => w.includes('Força 13'))).toBe(true) // Força 8 não atende a exigência da cota de malha
    expect(d.speed).toBe(30 - 10)
  })

  it('só uma armadura corporal fica equipada', () => {
    let character = build({ classSlug: 'fighter' })
    character = addItem(addItem(character, catalog, 'armor', 'chain-mail'), catalog, 'armor', 'leather-armor')
    const [mail, leather] = character.inventory
    character = setEquipped(setEquipped(character, catalog, mail!.id, true), catalog, leather!.id, true)
    expect(character.inventory.filter((i) => i.equipped).map((i) => i.slug)).toEqual(['leather-armor'])
  })
})

describe('Outras classes', () => {
  it('Monge usa Sabedoria na CA e ganha Movimento sem Armadura', () => {
    const monk = build({ classSlug: 'monk', level: 2, baseScores: { STR: 10, DEX: 15, CON: 12, INT: 8, WIS: 14, CHA: 10 } })
    const d = derive(monk, catalog)
    expect(d.ac.value).toBe(10 + 2 + 2)
    expect(d.speed).toBe(40)
    expect(d.attacks[0]).toMatchObject({ name: 'Unarmed Strike', damage: '1d6+2' })
  })

  it('Bruxo no nível 5 usa espaços de Magia de Pacto e 5 invocações (tabela de 2024)', () => {
    const plan = buildPlan(build({ classSlug: 'warlock', level: 5 }), catalog)
    expect(plan.casting.pact).toEqual({ count: 2, level: 3 })
    expect(plan.casting.maxSpellLevel).toBe(3)
    expect(plan.invocationCount).toBe(5)
    expect(plan.casting.ability).toBe('CHA')
  })

  it('Guerreiro tem ASI nos níveis 4, 6 e 8 e Clérigo escolhe Ordem Divina', () => {
    expect(buildPlan(build({ classSlug: 'fighter', level: 8 }), catalog).featSlots.map((s) => s.key)).toEqual(['fighting-style', 'asi-4', 'asi-6', 'asi-8'])
    const cleric = buildPlan(build({ classSlug: 'cleric' }), catalog)
    expect(cleric.orderOptions.map((o) => o.slug)).toEqual(['protector', 'thaumaturge'])
    expect(buildPlan(build({ classSlug: 'cleric', classOrder: 'thaumaturge' }), catalog).casting.cantrips).toBe(4)
  })

  it('Paladino pode trocar o Estilo de Luta por Guerreiro Abençoado', () => {
    const plan = buildPlan(build({ classSlug: 'paladin', level: 2, styleOption: 'blessed-warrior' }), catalog)
    expect(plan.casting).toMatchObject({ styleCantrips: 2, styleCantripClass: 'cleric' })
  })

  it('Ladino tem 2 especializações no nível 1 e 4 no nível 6', () => {
    expect(buildPlan(build({ classSlug: 'rogue' }), catalog).expertise.count).toBe(2)
    expect(buildPlan(build({ classSlug: 'rogue', level: 6 }), catalog).expertise.count).toBe(4)
  })
})

describe('espécie, equipamento e validação', () => {
  it('Elfo da Mata ganha velocidade 35 e Elfo Drow enxerga a 120 ft', () => {
    const wood = derive(build({ classSlug: 'fighter', speciesSlug: 'elf', speciesChoice: { lineage: 'wood-elf', size: 'Medium', skill: 'Insight', spellAbility: 'WIS' } }), catalog)
    expect(wood.speed).toBe(35)
    const drow = derive(build({ classSlug: 'fighter', speciesSlug: 'elf', speciesChoice: { lineage: 'drow', size: 'Medium', skill: null, spellAbility: null } }), catalog)
    expect(drow.darkvision).toBe(120)
  })

  it('Anão ganha +1 PV por nível', () => {
    const base = derive(build({ classSlug: 'fighter', level: 3, speciesSlug: 'human' }), catalog).hp
    expect(derive(build({ classSlug: 'fighter', level: 3, speciesSlug: 'dwarf' }), catalog).hp).toBe(base + 3)
  })

  it('opções de equipamento substituem os itens da mesma origem e equipam o que a classe sabe usar', () => {
    let cleric = build({ classSlug: 'cleric' })
    cleric = applyEquipmentOption(cleric, catalog, 'class', 'A')
    const equipped = cleric.inventory.filter((i) => i.equipped).map((i) => i.slug)
    expect(equipped).toEqual(expect.arrayContaining(['chain-shirt', 'shield', 'mace']))
    expect(cleric.inventory.some((i) => i.choices.length > 0)).toBe(true) // Holy Symbol ainda sem escolha
    cleric = applyEquipmentOption(cleric, catalog, 'class', 'B')
    expect(cleric.inventory).toEqual([])
    expect(derive(cleric, catalog).gold).toBe(cleric.classEquipment === 'B' ? 110 : 0)
  })

  it('personagem novo lista pendências em todas as etapas obrigatórias', () => {
    const steps = new Set(requiredIssues(validate(newCharacter(), catalog)).map((i) => i.step))
    expect([...steps].sort()).toEqual(['abilities', 'class', 'origin'])
  })

  it('normaliza fichas importadas e rejeita lixo', () => {
    expect(normalizeCharacter({ nope: true })).toBeNull()
    expect(normalizeCharacter(null)).toBeNull()
    const old = { ...newCharacter(), spells: { cantrips: ['x'] } }
    expect(normalizeCharacter(old)?.spells).toEqual({ cantrips: ['x'], spellbook: [], prepared: [], arcanum: {} })
  })
})
