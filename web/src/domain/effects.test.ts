import { describe, expect, it } from 'vitest'
import { autofill } from './autofill'
import { newCharacter } from './character'
import { derive } from './derive'
import { featureUses } from './effects'
import { requiredIssues, validate } from './validation'
import { catalog } from '../test/builders'

const make = (classSlug: string, level: number, extra: Parameters<typeof autofill>[2] = {}, patch: Partial<ReturnType<typeof newCharacter>> = {}) =>
  autofill({ ...newCharacter(), level, ...patch }, catalog, { classSlug, ...extra })

describe('efeitos automáticos de classe', () => {
  it('Ladino: Ataque Furtivo aparece nas armas com Acuidade e à distância, não no ataque desarmado', () => {
    const d = derive(make('rogue', 5), catalog)
    const rapier = d.attacks.find((a) => a.name === 'Shortsword')!
    expect(rapier.extras).toContain('Ataque Furtivo: +3d6 (1×/turno)')
    expect(d.attacks.find((a) => a.name === 'Unarmed Strike')!.extras).toEqual([])
    expect(d.attacks.find((a) => a.name === 'Shortbow')!.extras.some((e) => e.startsWith('Ataque Furtivo'))).toBe(true)
  })

  it('Bárbaro: bônus de dano da Fúria nos ataques corpo a corpo com Força', () => {
    const d = derive(make('barbarian', 9), catalog)
    expect(d.attacks.find((a) => a.name === 'Greataxe')!.extras).toContain('Em Fúria: +3 de dano')
    expect(d.attacks.find((a) => a.name === 'Handaxe')).toBeDefined()
  })

  it('Patrulheiro: Marca do Caçador sempre preparada e dano extra', () => {
    const d = derive(make('ranger', 3), catalog)
    expect(d.spells.find((s) => s.spell.slug === 'hunters-mark')?.sources[0]).toContain('Favored Enemy')
    expect(d.attacks.some((a) => a.extras.includes('Marca do Caçador: +1d6 (alvo marcado)'))).toBe(true)
    expect(derive(make('ranger', 20), catalog).attacks.some((a) => a.extras.some((e) => e.includes('+1d10')))).toBe(true)
  })

  it('Guerreiro e Paladino: reservas de recursos calculadas', () => {
    const fighter = derive(make('fighter', 17), catalog).resources
    expect(fighter).toContainEqual({ label: 'Action Surge', value: '2 por descanso' })
    expect(fighter).toContainEqual({ label: 'Indomitable', value: '3 por descanso longo' })
    expect(derive(make('paladin', 6), catalog).resources).toContainEqual({ label: 'Lay on Hands (reserva)', value: '30 PV' })
    expect(derive(make('wizard', 5), catalog).resources.find((r) => r.label === 'Arcane Recovery')?.value).toContain('nível 3')
  })

  it('Estilos de Luta: Armas Grandes e Duas Armas viram regras no ataque', () => {
    const fighter = make('fighter', 1, {}, { classSlug: 'fighter', feats: { 'fighting-style': { slug: 'great-weapon-fighting' } } })
    expect(derive(fighter, catalog).attacks.some((a) => a.extras.some((e) => e.startsWith('Armas Grandes')))).toBe(true)
  })
})

describe('Feiticeiro Dracônico: Afinidade Elemental', () => {
  // A fixture esvazia os textos das magias; devolve o do Fireball para testar a detecção do tipo de dano.
  const text = { ...catalog, spells: catalog.spells.map((s) => (s.slug === 'fireball' ? { ...s, description: 'Each creature takes 8d6 Fire damage on a failed save.' } : s)) }
  const sorcerer = (affinity: string | null) => {
    let c = make('sorcerer', 6)
    c = { ...c, subclassSlug: 'draconic-sorcery', elementalAffinity: affinity, spells: { ...c.spells, prepared: [...new Set([...c.spells.prepared.slice(0, 5), 'fireball'])] } }
    return c
  }

  it('exige a escolha do tipo de dano a partir do nível 6', () => {
    const c = { ...sorcerer(null), elementalAffinity: null }
    expect(requiredIssues(validate(c, catalog)).some((i) => i.message.includes('Afinidade Elemental'))).toBe(true)
    expect(requiredIssues(validate(sorcerer('Fire'), catalog)).some((i) => i.message.includes('Afinidade Elemental'))).toBe(false)
  })

  it('dá resistência e soma Carisma ao dano das magias do tipo', () => {
    const d = derive(sorcerer('Fire'), text)
    expect(d.defenses).toContain('Resistência a dano Fire (Afinidade Elemental)')
    const fireball = d.spells.find((s) => s.spell.slug === 'fireball')
    expect(fireball?.note).toMatch(/^Afinidade Elemental: \+\d+ em uma rolagem de dano \(Fire\)$/)
    expect(d.spells.filter((s) => s.note).map((s) => s.spell.slug)).toEqual(['fireball'])
  })

  it('antes do nível 6 não há afinidade', () => {
    const c = make('sorcerer', 5)
    expect(c.elementalAffinity).toBeNull()
  })
})

describe('espécie: ancestralidade do Golias e usos por descanso', () => {
  it('a ancestralidade escolhida vira característica com usos por Bônus de Proficiência', () => {
    const goliath = autofill(newCharacter(), catalog, { classSlug: 'fighter', speciesSlug: 'goliath' })
    expect(goliath.speciesChoice.lineage).toBeTruthy()
    const fire = derive({ ...goliath, speciesChoice: { ...goliath.speciesChoice, lineage: 'fires-burn' } }, catalog)
    const feature = fire.features.find((f) => f.name === 'Giant Ancestry: Fire’s Burn' || f.name.startsWith('Giant Ancestry:'))!
    expect(feature.text).toContain('Fire')
    expect(feature.uses).toBe('2× por descanso longo')
    expect(fire.resources.filter((r) => r.label === feature.name)).toHaveLength(1)
    expect(fire.features.find((f) => f.name === 'Giant Ancestry')!.uses).toBeNull() // o traço genérico não duplica os usos
  })

  it('Dragonborn mostra o Sopro com CD e dados; Orc e Gnomo mostram usos por Bônus de Proficiência', () => {
    const dragon = derive(autofill(newCharacter(), catalog, { classSlug: 'fighter', speciesSlug: 'dragonborn' }), catalog)
    expect(dragon.resources.find((r) => r.label === 'Breath Weapon')?.value).toMatch(/^CD \d+, 1d10, 2× por descanso longo$/)
    const orc = derive(autofill(newCharacter(), catalog, { classSlug: 'fighter', speciesSlug: 'orc' }), catalog)
    expect(orc.resources.find((r) => r.label === 'Adrenaline Rush')?.value).toBe('2× por descanso curto ou longo')
  })

  it('lê usos pelo Bônus de Proficiência ou por modificador de atributo', () => {
    const ctx = { character: newCharacter(), plan: derive(autofill(newCharacter(), catalog), catalog).plan, mods: { STR: 0, DEX: 0, CON: 0, INT: 0, WIS: 3, CHA: -1 }, pb: 4 }
    expect(featureUses('You can do it a number of times equal to your Proficiency Bonus, and you regain all expended uses when you finish a Long Rest.', ctx)).toBe('4× por descanso longo')
    expect(featureUses('a number of times equal to your Wisdom modifier (minimum of once). Short or Long Rest', ctx)).toBe('3× por descanso curto ou longo')
    expect(featureUses('a number of times equal to your Charisma modifier (minimum of once)', ctx)).toBe('1× por descanso longo')
    expect(featureUses('Nothing here', ctx)).toBeNull()
  })
})
