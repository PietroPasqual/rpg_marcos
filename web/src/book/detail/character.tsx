import type { Catalog, ClassData, SubclassData } from '../../api/types'
import { Chip, Markdown } from '../../components/ui'
import { ABILITY_LABEL } from '../../domain/srd'
import { bookHref } from '../sections'

const prettify = (key: string): string => key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
const ordinal = (n: number): string => `${n}º`

function LevelTable({ cls }: { cls: ClassData }) {
  const keys = [...new Set(cls.level_table.flatMap((row) => Object.keys(row.class_specific_columns)))]
  const casting = cls.level_table.some((row) => row.spellcasting)
  const pact = cls.level_table.some((row) => row.spellcasting?.pact_slots_count)
  const slotLevels = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((lvl) => cls.level_table.some((row) => (row.spellcasting?.slots_by_level[String(lvl)] ?? 0) > 0))
  const showCantrips = cls.level_table.some((row) => row.spellcasting?.cantrips_known)
  return (
    <div className="table-scroll">
      <table className="book-table level-table">
        <caption className="sr-only">Tabela de características de {cls.name}</caption>
        <thead>
          <tr>
            <th>Nível</th>
            <th>Prof.</th>
            <th>Características</th>
            {keys.map((k) => (
              <th key={k}>{prettify(k)}</th>
            ))}
            {casting && showCantrips && <th>Truques</th>}
            {casting && <th>Preparadas</th>}
            {pact ? <th>Espaços de pacto</th> : slotLevels.map((lvl) => <th key={lvl}>{ordinal(lvl)}</th>)}
          </tr>
        </thead>
        <tbody>
          {cls.level_table.map((row) => (
            <tr key={row.level}>
              <th scope="row">{row.level}</th>
              <td>+{row.proficiency_bonus}</td>
              <td className="left">{row.feature_names.join(', ') || '—'}</td>
              {keys.map((k) => (
                <td key={k}>{row.class_specific_columns[k] ?? '—'}</td>
              ))}
              {casting && showCantrips && <td>{row.spellcasting?.cantrips_known ?? '—'}</td>}
              {casting && <td>{row.spellcasting?.prepared_spells || '—'}</td>}
              {pact ? (
                <td>{row.spellcasting?.pact_slots_count ? `${row.spellcasting.pact_slots_count} × nível ${row.spellcasting.pact_slot_level}` : '—'}</td>
              ) : (
                slotLevels.map((lvl) => <td key={lvl}>{row.spellcasting?.slots_by_level[String(lvl)] || '—'}</td>)
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ClassDetail({ cls, catalog }: { cls: ClassData; catalog: Catalog }) {
  const subclasses = catalog.subclasses.filter((s) => s.parent_class_slug === cls.slug)
  const options = catalog.featureOptions.filter((o) => o.parent_class_slug === cls.slug)
  const categories = [...new Set(options.map((o) => o.category))]
  return (
    <article className="entry">
      <h2>{cls.name}</h2>
      <p className="chips">
        <Chip tone="accent">{cls.hit_point_die}</Chip>
        <Chip>{cls.primary_abilities.map((a) => ABILITY_LABEL[a]).join(cls.primary_ability_logic === 'AND' ? ' e ' : ' ou ')}</Chip>
        {cls.spellcasting_ability && <Chip>Conjuração: {ABILITY_LABEL[cls.spellcasting_ability]}</Chip>}
        {cls.has_weapon_mastery && <Chip>Maestria de arma</Chip>}
      </p>

      <h3>Traços básicos</h3>
      <dl className="facts">
        <dt>Salvaguardas</dt>
        <dd>{cls.saving_throw_proficiencies.map((a) => ABILITY_LABEL[a]).join(', ')}</dd>
        <dt>Perícias</dt>
        <dd>
          Escolha {cls.skill_choices_count}: {cls.skill_options.join(', ')}
        </dd>
        <dt>Armas</dt>
        <dd>{cls.weapon_proficiencies.join('; ') || '—'}</dd>
        <dt>Armaduras</dt>
        <dd>{cls.armor_training.join('; ') || 'Nenhuma'}</dd>
        {cls.tool_proficiencies.length > 0 && (
          <>
            <dt>Ferramentas</dt>
            <dd>{cls.tool_proficiencies.join('; ')}</dd>
          </>
        )}
        <dt>Equipamento inicial</dt>
        <dd>
          {cls.starting_equipment_options.map((o) => (
            <div key={o.option_label}>
              <strong>({o.option_label})</strong> {o.items.map((i) => `${i.quantity > 1 ? `${i.quantity}× ` : ''}${i.item_name}`).join(', ')}
              {o.gold_gp ? `${o.items.length ? ', ' : ''}${o.gold_gp} GP` : ''}
            </div>
          ))}
        </dd>
      </dl>

      <h3>Características por nível</h3>
      <LevelTable cls={cls} />

      <h3>Características de classe</h3>
      {cls.features.map((f) => (
        <section key={f.slug + f.level} className="feature">
          <h4>
            {f.name} <span className="muted">· nível {f.level}</span>
          </h4>
          <Markdown>{f.description}</Markdown>
        </section>
      ))}

      {subclasses.length > 0 && (
        <>
          <h3>Subclasses</h3>
          <ul className="link-list">
            {subclasses.map((s) => (
              <li key={s.slug}>
                <a href={bookHref('subclasses', s.slug)}>{s.name}</a>
              </li>
            ))}
          </ul>
        </>
      )}

      {categories.map((category) => (
        <div key={category}>
          <h3>{category}</h3>
          {options
            .filter((o) => o.category === category)
            .map((o) => (
              <section key={o.slug} className="feature">
                <h4>
                  {o.name}
                  {(o.prerequisite_text || o.cost_text) && <span className="muted"> · {o.prerequisite_text ?? o.cost_text}</span>}
                </h4>
                <Markdown>{o.description}</Markdown>
              </section>
            ))}
        </div>
      ))}

      <h3>Multiclasse</h3>
      <p className="muted">Para entrar em {cls.name} por multiclasse, é preciso valor 13 no atributo principal da classe ({cls.primary_abilities.map((a) => ABILITY_LABEL[a]).join(cls.primary_ability_logic === 'AND' ? ' e ' : ' ou ')}) e nos das classes atuais.</p>
    </article>
  )
}

export function SubclassDetail({ subclass, catalog }: { subclass: SubclassData; catalog: Catalog }) {
  const parent = catalog.classes.find((c) => c.slug === subclass.parent_class_slug)
  return (
    <article className="entry">
      <h2>{subclass.name}</h2>
      <p className="muted">
        Subclasse de <a href={bookHref('classes', subclass.parent_class_slug)}>{parent?.name ?? subclass.parent_class_name}</a>
      </p>
      {subclass.features.map((f) => (
        <section key={f.slug + f.level} className="feature">
          <h4>
            {f.name} <span className="muted">· nível {f.level}</span>
          </h4>
          <Markdown>{f.description}</Markdown>
        </section>
      ))}
    </article>
  )
}
