import type { Catalog, SpellData } from '../api/types'
import type { Character } from './character'
import type { Plan } from './plan'

/** Magias da lista de uma classe. */
export function classSpells(catalog: Catalog, classSlug: string): SpellData[] {
  return catalog.spells.filter((s) => s.class_lists.includes(classSlug))
}

/** Lista de onde o personagem escolhe cada tipo de magia da classe. */
export function spellPools(character: Character, plan: Plan, catalog: Catalog) {
  const cls = plan.cls?.slug
  const classList = cls ? classSpells(catalog, cls) : []
  const max = plan.casting.maxSpellLevel
  const cantrips = classList.filter((s) => s.level === 0)
  const leveled = classList.filter((s) => s.level >= 1 && s.level <= max)
  // Mago: prepara a partir do grimório; os demais, a partir da lista da classe.
  const prepared = cls === 'wizard' ? leveled.filter((s) => character.spells.spellbook.includes(s.slug)) : leveled
  const style = plan.casting.styleCantripClass ? classSpells(catalog, plan.casting.styleCantripClass).filter((s) => s.level === 0) : []
  const arcanum = Object.fromEntries(plan.casting.arcanumLevels.map((lvl) => [lvl, classList.filter((s) => s.level === lvl)]))
  return { cantrips, spellbook: leveled, prepared, style, arcanum }
}
