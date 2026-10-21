import type { Catalog, SpellData } from '../api/types'
import type { ClassPicks } from './character'
import type { ClassPlan } from './plan'

/** Magias da lista de uma classe. */
export function classSpells(catalog: Catalog, classSlug: string): SpellData[] {
  return catalog.spells.filter((s) => s.class_lists.includes(classSlug))
}

/** Lista de onde o personagem escolhe cada tipo de magia de uma classe. */
export function spellPools(picks: ClassPicks, classPlan: ClassPlan | null, catalog: Catalog) {
  const cls = classPlan?.slug
  const classList = cls ? classSpells(catalog, cls) : []
  const casting = classPlan?.casting
  const max = casting?.maxSpellLevel ?? 0
  const cantrips = classList.filter((s) => s.level === 0)
  const leveled = classList.filter((s) => s.level >= 1 && s.level <= max)
  // Mago: prepara a partir do grimório; os demais, a partir da lista da classe.
  const prepared = cls === 'wizard' ? leveled.filter((s) => picks.spells.spellbook.includes(s.slug)) : leveled
  const style = casting?.styleCantripClass ? classSpells(catalog, casting.styleCantripClass).filter((s) => s.level === 0) : []
  const arcanum = Object.fromEntries((casting?.arcanumLevels ?? []).map((lvl) => [lvl, classList.filter((s) => s.level === lvl)]))
  return { cantrips, spellbook: leveled, prepared, style, arcanum }
}
