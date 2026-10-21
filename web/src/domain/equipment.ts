import type { ArmorData, Catalog, EquipmentItem, ItemType } from '../api/types'
import { armorTrainingForPlan, type ArmorTier } from './derive'
import { newId, type Character, type InventoryItem } from './character'
import { lookup, type Lookup } from './lookup'
import { buildPlan } from './plan'

const armorTier = (armor: ArmorData): ArmorTier => armor.category.replace(' Armor', '') as ArmorTier

export function itemName(look: Lookup, type: ItemType | null, slug: string | null, fallback: string): string {
  if (!slug || !type) return fallback
  const map = { weapon: look.weapons, armor: look.armor, tool: look.tools, gear: look.gear }[type]
  return map.get(slug)?.name ?? fallback
}

function fromEquipment(eq: EquipmentItem, source: InventoryItem['source'], look: Lookup): InventoryItem {
  // Mantém o nome do SRD quando ele traz um detalhe útil ("Book (prayers)"); senão usa o nome do catálogo.
  const name = eq.item_name.includes('(') ? eq.item_name : itemName(look, eq.item_type, eq.item_slug, eq.item_name)
  return { id: newId(), slug: eq.item_slug, type: eq.item_type, name, quantity: eq.quantity, source, equipped: false, choices: eq.choose_from }
}

/** Equipa armas e a melhor armadura/escudo para os quais a classe tem treinamento. */
export function autoEquip(character: Character, catalog: Catalog): InventoryItem[] {
  const look = lookup(catalog)
  const trained = armorTrainingForPlan(buildPlan(character, catalog))
  const items = character.inventory.map((i) => ({ ...i }))

  let bestBody: { item: InventoryItem; ac: number } | null = null
  for (const item of items) {
    if (item.type === 'weapon' && item.slug && !item.equipped) item.equipped = true
    if (item.type !== 'armor' || !item.slug) continue
    const armor = look.armor.get(item.slug)
    if (!armor || !trained.has(armorTier(armor))) continue
    if (armor.category === 'Shield') {
      if (!items.some((o) => o.equipped && o.type === 'armor' && look.armor.get(o.slug ?? '')?.category === 'Shield')) item.equipped = true
    } else if (!items.some((o) => o.equipped && o.type === 'armor' && look.armor.get(o.slug ?? '')?.category !== 'Shield')) {
      if (!bestBody || armor.base_ac > bestBody.ac) bestBody = { item, ac: armor.base_ac }
    }
  }
  if (bestBody) bestBody.item.equipped = true
  return items
}

/** Troca a opção de equipamento inicial (A/B/C) de 'class' ou 'background', substituindo os itens dessa origem. */
export function applyEquipmentOption(character: Character, catalog: Catalog, who: 'class' | 'background', label: string | null): Character {
  const look = lookup(catalog)
  const cls = character.classSlug ? look.classes.get(character.classSlug) : undefined
  const bg = character.backgroundSlug ? look.backgrounds.get(character.backgroundSlug) : undefined
  const options = who === 'class' ? (cls?.starting_equipment_options ?? []) : (bg?.equipment_options ?? [])
  const option = options.find((o) => o.option_label === label)

  const kept = character.inventory.filter((i) => i.source !== who)
  const added = (option?.items ?? []).map((eq) => fromEquipment(eq, who, look))
  const next: Character = {
    ...character,
    inventory: [...kept, ...added],
    ...(who === 'class' ? { classEquipment: option ? label : null } : { backgroundEquipment: option ? label : null }),
  }
  return { ...next, inventory: autoEquip(next, catalog) }
}

export function resolveChoice(character: Character, itemId: string, slug: string, catalog: Catalog): Character {
  const look = lookup(catalog)
  const inventory = character.inventory.map((item) => {
    if (item.id !== itemId) return item
    return { ...item, slug, name: itemName(look, item.type, slug, item.name), choices: [] }
  })
  return { ...character, inventory }
}

export function addItem(character: Character, catalog: Catalog, type: ItemType, slug: string): Character {
  const look = lookup(catalog)
  const name = itemName(look, type, slug, slug)
  const existing = character.inventory.find((i) => i.slug === slug && i.type === type && i.source === 'custom')
  if (existing) return setQuantity(character, existing.id, existing.quantity + 1)
  const item: InventoryItem = { id: newId(), slug, type, name, quantity: 1, source: 'custom', equipped: false, choices: [] }
  return { ...character, inventory: [...character.inventory, item] }
}

export function removeItem(character: Character, itemId: string): Character {
  return { ...character, inventory: character.inventory.filter((i) => i.id !== itemId) }
}

export function setQuantity(character: Character, itemId: string, quantity: number): Character {
  if (quantity < 1) return removeItem(character, itemId)
  return { ...character, inventory: character.inventory.map((i) => (i.id === itemId ? { ...i, quantity } : i)) }
}

/** Equipa/desequipa um item; só uma armadura corporal e um escudo podem estar equipados. */
export function setEquipped(character: Character, catalog: Catalog, itemId: string, equipped: boolean): Character {
  const look = lookup(catalog)
  const target = character.inventory.find((i) => i.id === itemId)
  if (!target) return character
  const targetArmor = target.type === 'armor' && target.slug ? look.armor.get(target.slug) : undefined
  const inventory = character.inventory.map((item) => {
    if (item.id === itemId) return { ...item, equipped }
    if (equipped && targetArmor && item.type === 'armor' && item.slug) {
      const other = look.armor.get(item.slug)
      if (other && (other.category === 'Shield') === (targetArmor.category === 'Shield')) return { ...item, equipped: false }
    }
    return item
  })
  return { ...character, inventory }
}
