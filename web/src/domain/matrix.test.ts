import { describe, expect, it } from 'vitest'
import { autofill } from './autofill'
import { newCharacter } from './character'
import { derive } from './derive'
import { requiredIssues, validate } from './validation'
import { catalog } from '../test/builders'

const LEVELS = [1, 2, 3, 4, 5, 6, 8, 9, 11, 13, 17, 19, 20]

describe('toda combinação de classe e nível pode ser completada', () => {
  for (const cls of catalog.classes) {
    it(`${cls.name}: níveis ${LEVELS.join(', ')}`, () => {
      for (const level of LEVELS) {
        const character = autofill({ ...newCharacter(), level }, catalog, { classSlug: cls.slug })
        const pending = requiredIssues(validate(character, catalog))
        expect(pending, `${cls.name} nível ${level}`).toEqual([])
        const d = derive(character, catalog)
        expect(d.hp, `PV de ${cls.name} ${level}`).toBeGreaterThan(0)
        expect(d.ac.value).toBeGreaterThanOrEqual(8)
        expect(d.ac.value).toBeLessThanOrEqual(30)
        expect(Object.values(d.scores).every((s) => s.total >= 3 && s.total <= 30)).toBe(true)
        expect(d.skills.every((s) => Number.isFinite(s.mod))).toBe(true)
      }
    })
  }
})

describe('toda espécie e antecedente podem ser completados', () => {
  for (const species of catalog.species) {
    for (const background of catalog.backgrounds) {
      it(`${species.name} + ${background.name}`, () => {
        const character = autofill(newCharacter(), catalog, { classSlug: 'wizard', speciesSlug: species.slug, backgroundSlug: background.slug })
        expect(requiredIssues(validate(character, catalog))).toEqual([])
        expect(derive(character, catalog).features.length).toBeGreaterThan(3)
      })
    }
  }
})

describe('preenchimento automático', () => {
  it('não altera escolhas já feitas', () => {
    const base = autofill(newCharacter(), catalog, { classSlug: 'rogue', speciesSlug: 'elf' })
    const again = autofill(base, catalog)
    expect(again).toEqual(base)
  })

  it('preserva o que o jogador escolheu', () => {
    const picked = { ...newCharacter(), classSlug: 'cleric', classOrder: 'thaumaturge', level: 3 }
    const filled = autofill(picked, catalog)
    expect(filled.classOrder).toBe('thaumaturge')
    expect(filled.classSlug).toBe('cleric')
  })
})
