import type { Catalog, MagicItemData, MonsterData, MonsterTrait, SpellData } from '../../api/types'
import { Chip, Markdown } from '../../components/ui'
import { formatBonus } from '../../domain/derive'
import { ABILITIES } from '../../domain/srd'
import { bookHref } from '../sections'

export function SpellDetail({ spell, catalog }: { spell: SpellData; catalog: Catalog }) {
  const components = [spell.components.verbal && 'V', spell.components.somatic && 'S', spell.components.material && `M (${spell.components.material_description ?? ''})`].filter(Boolean).join(', ')
  return (
    <article className="entry">
      <h2>{spell.name}</h2>
      <p className="muted">
        {spell.level === 0 ? `Truque de ${spell.school}` : `${spell.school}, nível ${spell.level}`}
        {spell.ritual && ' (ritual)'}
      </p>
      <dl className="facts">
        <dt>Tempo de conjuração</dt>
        <dd>{spell.casting_time}</dd>
        <dt>Alcance</dt>
        <dd>{spell.range}</dd>
        <dt>Componentes</dt>
        <dd>{components || '—'}</dd>
        <dt>Duração</dt>
        <dd>{spell.duration}</dd>
      </dl>
      <Markdown>{spell.description}</Markdown>
      {spell.higher_levels && <Markdown>{`**Em níveis mais altos.** ${spell.higher_levels}`}</Markdown>}
      <p className="chips">
        {spell.class_lists.map((slug) => (
          <a key={slug} className="chip chip-link" href={bookHref('classes', slug)}>
            {catalog.classes.find((c) => c.slug === slug)?.name ?? slug}
          </a>
        ))}
      </p>
    </article>
  )
}

export function MagicItemDetail({ item, catalog }: { item: MagicItemData; catalog: Catalog }) {
  const weapon = item.base_weapon_or_armor_slug ? catalog.weapons.find((w) => w.slug === item.base_weapon_or_armor_slug) : undefined
  const armor = item.base_weapon_or_armor_slug ? catalog.armor.find((a) => a.slug === item.base_weapon_or_armor_slug) : undefined
  return (
    <article className="entry">
      <h2>{item.name}</h2>
      <p className="chips">
        <Chip tone="accent">{item.rarity}</Chip>
        <Chip>{item.item_category}</Chip>
        {item.requires_attunement && <Chip tone="warn">Requer sintonização{item.attunement_requirement ? `: ${item.attunement_requirement.replace(/^Requires Attunement/i, '').trim()}` : ''}</Chip>}
        {weapon && <a className="chip chip-link" href={bookHref('armas', weapon.slug)}>{weapon.name}</a>}
        {armor && <a className="chip chip-link" href={bookHref('armaduras', armor.slug)}>{armor.name}</a>}
      </p>
      <Markdown>{item.description}</Markdown>
    </article>
  )
}

function TraitList({ title, items }: { title?: string; items: MonsterTrait[] }) {
  if (items.length === 0) return null
  return (
    <>
      {title && <h3 className="stat-heading">{title}</h3>}
      {items.map((t) => (
        <div key={t.name + t.description.slice(0, 20)} className="stat-trait">
          <Markdown>{`***${t.name}.*** ${t.description}`}</Markdown>
        </div>
      ))}
    </>
  )
}

export function MonsterDetail({ monster }: { monster: MonsterData }) {
  const speeds = Object.entries(monster.speeds).map(([k, v]) => (k === 'walk' ? v : `${k} ${v}`)).join(', ')
  const senses = Object.entries(monster.senses).map(([k, v]) => (k === 'passive_perception' ? `Passive Perception ${v}` : `${k} ${v}`)).join(', ')
  const skills = Object.entries(monster.skills).map(([k, v]) => `${k} ${formatBonus(v)}`).join(', ')
  const line = (label: string, values: string[]) => (values.length ? (
    <p>
      <strong>{label}</strong> {values.join(', ')}
    </p>
  ) : null)
  return (
    <article className="entry stat-block">
      <h2>{monster.name}</h2>
      <p className="muted">
        <em>
          {monster.size.join(' or ')} {monster.creature_type}, {monster.alignment}
        </em>
      </p>
      <p>
        <strong>AC</strong> {monster.armor_class}
        {monster.armor_notes ? ` (${monster.armor_notes})` : ''} · <strong>Initiative</strong> {formatBonus(monster.initiative_bonus)} ({monster.initiative_passive}) · <strong>HP</strong> {monster.hit_points} ({monster.hit_dice_formula})
      </p>
      <p>
        <strong>Speed</strong> {speeds}
      </p>
      <div className="table-scroll">
        <table className="book-table ability-table">
          <thead>
            <tr>
              <th />
              {ABILITIES.map((a) => (
                <th key={a} colSpan={1}>
                  {a}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Score</th>
              {ABILITIES.map((a) => (
                <td key={a}>{monster.abilities[a].score}</td>
              ))}
            </tr>
            <tr>
              <th scope="row">Mod</th>
              {ABILITIES.map((a) => (
                <td key={a}>{formatBonus(monster.abilities[a].modifier)}</td>
              ))}
            </tr>
            <tr>
              <th scope="row">Save</th>
              {ABILITIES.map((a) => (
                <td key={a}>{formatBonus(monster.abilities[a].saving_throw)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {skills && (
        <p>
          <strong>Skills</strong> {skills}
        </p>
      )}
      {line('Vulnerabilities', monster.damage_vulnerabilities)}
      {line('Resistances', monster.damage_resistances)}
      {line('Immunities', [...monster.damage_immunities, ...monster.condition_immunities])}
      <p>
        <strong>Senses</strong> {senses}
      </p>
      {monster.languages.length > 0 ? line('Languages', monster.languages) : <p><strong>Languages</strong> None</p>}
      <p>
        <strong>CR</strong> {monster.challenge_rating} (XP {monster.xp.toLocaleString('pt-BR')}; PB {formatBonus(monster.proficiency_bonus)})
      </p>
      <TraitList title="Traits" items={monster.traits} />
      <TraitList title="Actions" items={monster.actions} />
      <TraitList title="Bonus Actions" items={monster.bonus_actions} />
      <TraitList title="Reactions" items={monster.reactions} />
      <TraitList title="Legendary Actions" items={monster.legendary_actions} />
    </article>
  )
}
