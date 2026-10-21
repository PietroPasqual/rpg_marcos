import type {
  ArmorData,
  BackgroundData,
  Catalog,
  ClassData,
  FeatData,
  FeatureOption,
  GearData,
  SpeciesData,
  SpellData,
  SubclassData,
  ToolData,
  WeaponData,
  WeaponMasteryData,
} from '../api/types'

export interface Lookup {
  classes: Map<string, ClassData>
  subclasses: Map<string, SubclassData>
  species: Map<string, SpeciesData>
  backgrounds: Map<string, BackgroundData>
  feats: Map<string, FeatData>
  spells: Map<string, SpellData>
  weapons: Map<string, WeaponData>
  armor: Map<string, ArmorData>
  tools: Map<string, ToolData>
  gear: Map<string, GearData>
  masteries: Map<string, WeaponMasteryData>
  options: Map<string, FeatureOption>
}

const cache = new WeakMap<Catalog, Lookup>()

const byslug = <T extends { slug: string }>(items: T[]): Map<string, T> => new Map(items.map((item) => [item.slug, item]))

export function lookup(catalog: Catalog): Lookup {
  let found = cache.get(catalog)
  if (!found) {
    found = {
      classes: byslug(catalog.classes),
      subclasses: byslug(catalog.subclasses),
      species: byslug(catalog.species),
      backgrounds: byslug(catalog.backgrounds),
      feats: byslug(catalog.feats),
      spells: byslug(catalog.spells),
      weapons: byslug(catalog.weapons),
      armor: byslug(catalog.armor),
      tools: byslug(catalog.tools),
      gear: byslug(catalog.gear),
      masteries: byslug(catalog.masteries),
      options: byslug(catalog.featureOptions),
    }
    cache.set(catalog, found)
  }
  return found
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Extrai opções "**Nome.** texto" de uma descrição em Markdown (ex.: Divine Order). */
export function parseBoldOptions(description: string): { slug: string; name: string; text: string }[] {
  const options: { slug: string; name: string; text: string }[] = []
  const pattern = /\*\*([^*\n]+?)\.\*\*\s+([\s\S]+?)(?=\n\n|$)/g
  for (const match of description.matchAll(pattern)) {
    options.push({ slug: slugify(match[1]!), name: match[1]!.trim(), text: match[2]!.trim() })
  }
  return options
}
