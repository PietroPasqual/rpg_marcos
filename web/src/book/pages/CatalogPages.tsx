import { useMemo, useState } from 'react'
import type { Catalog, WeaponData } from '../../api/types'
import { Chip, Markdown, Notice } from '../../components/ui'
import { ABILITY_LABEL } from '../../domain/srd'
import { ClassDetail, SubclassDetail } from '../detail/character'
import { BackgroundDetail, FeatDetail, SpeciesDetail } from '../detail/origins'
import { MagicItemDetail, MonsterDetail, SpellDetail } from '../detail/world'
import { useMagicItems, useMonsters } from '../lazy'
import { MasterDetail } from '../MasterDetail'
import { bookHref } from '../sections'

interface Props {
  catalog: Catalog
  slug?: string
}

const Loading = ({ what }: { what: string }) => (
  <div className="loading" role="status">
    <div className="spinner" aria-hidden="true" />
    Carregando {what}…
  </div>
)

// ---------- Personagem ----------

export function ClassesPage({ catalog, slug }: Props) {
  return (
    <MasterDetail
      section="classes"
      title="Classes"
      items={catalog.classes}
      all={catalog.classes}
      selected={slug}
      row={(c) => (
        <>
          <span>{c.name}</span>
          <span className="muted">
            {c.hit_point_die} · {c.primary_abilities.map((a) => a).join('/')}
          </span>
        </>
      )}
      detail={(c) => <ClassDetail cls={c} catalog={catalog} />}
      intro={<p className="muted">As 12 classes do SRD 5.2.1, com tabela de níveis, características, subclasses e opções (Invocações, Metamagia).</p>}
    />
  )
}

export function SubclassesPage({ catalog, slug }: Props) {
  return (
    <MasterDetail
      section="subclasses"
      title="Subclasses"
      items={catalog.subclasses}
      all={catalog.subclasses}
      selected={slug}
      searchText={(s) => `${s.name} ${s.parent_class_name}`}
      row={(s) => (
        <>
          <span>{s.name}</span>
          <span className="muted">{s.parent_class_name}</span>
        </>
      )}
      detail={(s) => <SubclassDetail subclass={s} catalog={catalog} />}
    />
  )
}

export function SpeciesPage({ catalog, slug }: Props) {
  return (
    <MasterDetail
      section="especies"
      title="Espécies"
      items={catalog.species}
      all={catalog.species}
      selected={slug}
      row={(s) => (
        <>
          <span>{s.name}</span>
          <span className="muted">{s.sizes.join(' ou ')} · {s.speed_ft} ft</span>
        </>
      )}
      detail={(s) => <SpeciesDetail species={s} />}
    />
  )
}

export function BackgroundsPage({ catalog, slug }: Props) {
  return (
    <MasterDetail
      section="antecedentes"
      title="Antecedentes"
      items={catalog.backgrounds}
      all={catalog.backgrounds}
      selected={slug}
      row={(b) => (
        <>
          <span>{b.name}</span>
          <span className="muted">{b.origin_feat_name}</span>
        </>
      )}
      detail={(b) => <BackgroundDetail background={b} catalog={catalog} />}
    />
  )
}

export function FeatsPage({ catalog, slug }: Props) {
  const [category, setCategory] = useState('')
  const items = useMemo(() => catalog.feats.filter((f) => !category || f.category === category), [catalog.feats, category])
  return (
    <MasterDetail
      section="talentos"
      title="Talentos"
      items={items}
      all={catalog.feats}
      selected={slug}
      filters={
        <select aria-label="Categoria" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Todas as categorias</option>
          {['Origin', 'General', 'Fighting Style', 'Epic Boon'].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      }
      row={(f) => (
        <>
          <span>{f.name}</span>
          <Chip>{f.category}</Chip>
        </>
      )}
      detail={(f) => <FeatDetail feat={f} />}
    />
  )
}

// ---------- Magias ----------

export function SpellsPage({ catalog, slug }: Props) {
  const [level, setLevel] = useState('')
  const [school, setSchool] = useState('')
  const [cls, setCls] = useState('')
  const [only, setOnly] = useState('')
  const schools = useMemo(() => [...new Set(catalog.spells.map((s) => s.school))].sort(), [catalog.spells])
  const items = useMemo(
    () =>
      catalog.spells.filter(
        (s) =>
          (!level || s.level === Number(level)) &&
          (!school || s.school === school) &&
          (!cls || s.class_lists.includes(cls)) &&
          (only !== 'concentration' || s.concentration) &&
          (only !== 'ritual' || s.ritual),
      ),
    [catalog.spells, level, school, cls, only],
  )
  return (
    <MasterDetail
      section="magias"
      title="Magias"
      items={items}
      all={catalog.spells}
      selected={slug}
      pageSize={80}
      filters={
        <div className="filter-grid">
          <select aria-label="Nível" value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">Todos os níveis</option>
            <option value="0">Truques</option>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <option key={n} value={n}>
                Nível {n}
              </option>
            ))}
          </select>
          <select aria-label="Escola" value={school} onChange={(e) => setSchool(e.target.value)}>
            <option value="">Todas as escolas</option>
            {schools.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select aria-label="Classe" value={cls} onChange={(e) => setCls(e.target.value)}>
            <option value="">Todas as classes</option>
            {catalog.classes
              .filter((c) => c.spellcasting_ability)
              .map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
          </select>
          <select aria-label="Característica" value={only} onChange={(e) => setOnly(e.target.value)}>
            <option value="">Qualquer</option>
            <option value="concentration">Só concentração</option>
            <option value="ritual">Só rituais</option>
          </select>
        </div>
      }
      row={(s) => (
        <>
          <span>{s.name}</span>
          <span className="muted">
            {s.level === 0 ? 'Truque' : `Nível ${s.level}`} · {s.school}
          </span>
          {s.concentration && <Chip tone="warn">C</Chip>}
          {s.ritual && <Chip>R</Chip>}
        </>
      )}
      detail={(s) => <SpellDetail spell={s} catalog={catalog} />}
    />
  )
}

// ---------- Equipamento ----------

function WeaponCard({ weapon, catalog }: { weapon: WeaponData; catalog: Catalog }) {
  const mastery = catalog.masteries.find((m) => m.slug === weapon.mastery_slug)
  return (
    <div className="entry detail-card">
      <h3>{weapon.name}</h3>
      <p className="muted">
        {weapon.category} · {weapon.damage_dice} {weapon.damage_type}
        {weapon.versatile_damage_dice ? ` (${weapon.versatile_damage_dice} a duas mãos)` : ''} · {weapon.cost_display} · {weapon.weight_lb} lb
      </p>
      <p>
        <strong>Propriedades:</strong> {weapon.properties.join(', ') || '—'} (<a href={bookHref('regras', 'book-equipment-properties')}>regras das propriedades</a>)
      </p>
      {mastery && (
        <>
          <p>
            <strong>Maestria: {mastery.name}.</strong>
          </p>
          <Markdown>{mastery.description}</Markdown>
        </>
      )}
    </div>
  )
}

export function WeaponsPage({ catalog, slug }: Props) {
  const [category, setCategory] = useState('')
  const [mastery, setMastery] = useState('')
  const items = catalog.weapons.filter((w) => (!category || w.category === category) && (!mastery || w.mastery_slug === mastery))
  const selected = slug ? catalog.weapons.find((w) => w.slug === slug) : undefined
  return (
    <div className="entry-page">
      <h2>Armas</h2>
      <div className="filter-grid">
        <select aria-label="Categoria" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Todas as categorias</option>
          {[...new Set(catalog.weapons.map((w) => w.category))].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select aria-label="Maestria" value={mastery} onChange={(e) => setMastery(e.target.value)}>
          <option value="">Todas as maestrias</option>
          {catalog.masteries.map((m) => (
            <option key={m.slug} value={m.slug}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      {selected && <WeaponCard weapon={selected} catalog={catalog} />}
      <div className="table-scroll">
        <table className="book-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Dano</th>
              <th>Propriedades</th>
              <th>Maestria</th>
              <th>Peso</th>
              <th>Custo</th>
            </tr>
          </thead>
          <tbody>
            {items.map((w) => (
              <tr key={w.slug} className={w.slug === slug ? 'selected' : ''}>
                <th scope="row" className="left">
                  <a href={bookHref('armas', w.slug)}>{w.name}</a>
                </th>
                <td>
                  {w.damage_dice} {w.damage_type}
                </td>
                <td className="left">{w.properties.join(', ') || '—'}</td>
                <td>{w.mastery_name}</td>
                <td>{w.weight_lb} lb</td>
                <td>{w.cost_display}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Maestrias de arma</h3>
      <ul className="plain">
        {catalog.masteries.map((m) => (
          <li key={m.slug}>
            <strong>{m.name}.</strong> {m.effect_summary}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ArmorPage({ catalog, slug }: Props) {
  const selected = slug ? catalog.armor.find((a) => a.slug === slug) : undefined
  return (
    <div className="entry-page">
      <h2>Armaduras</h2>
      {slug && !selected && <Notice tone="warn">Armadura “{slug}” não encontrada.</Notice>}
      <div className="table-scroll">
        <table className="book-table">
          <thead>
            <tr>
              <th>Armadura</th>
              <th>Categoria</th>
              <th>Classe de Armadura</th>
              <th>Força</th>
              <th>Furtividade</th>
              <th>Peso</th>
              <th>Custo</th>
            </tr>
          </thead>
          <tbody>
            {catalog.armor.map((a) => (
              <tr key={a.slug} className={a.slug === slug ? 'selected' : ''}>
                <th scope="row" className="left">
                  <a href={bookHref('armaduras', a.slug)}>{a.name}</a>
                </th>
                <td>{a.category}</td>
                <td>{a.ac_formula_display}</td>
                <td>{a.strength_requirement ?? '—'}</td>
                <td>{a.stealth_disadvantage ? 'Desvantagem' : '—'}</td>
                <td>{a.weight_lb} lb</td>
                <td>{a.cost_display}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        Regras de vestir, tirar e treinamento com armaduras: <a href={bookHref('regras', 'book-equipment-armor')}>capítulo Armor</a>.
      </p>
    </div>
  )
}

export function ToolsPage({ catalog, slug }: Props) {
  return (
    <MasterDetail
      section="ferramentas"
      title="Ferramentas"
      items={catalog.tools}
      all={catalog.tools}
      selected={slug}
      row={(t) => (
        <>
          <span>{t.name}</span>
          <span className="muted">{t.category} · {t.cost_display}</span>
        </>
      )}
      detail={(t) => (
        <article className="entry">
          <h2>{t.name}</h2>
          <p className="chips">
            <Chip>{t.category}</Chip>
            <Chip>{ABILITY_LABEL[t.ability]}</Chip>
            <Chip>{t.cost_display}</Chip>
            <Chip>{t.weight_lb} lb</Chip>
          </p>
          <Markdown>{t.description}</Markdown>
        </article>
      )}
    />
  )
}

export function GearPage({ catalog, slug }: Props) {
  const [category, setCategory] = useState('')
  const items = useMemo(() => catalog.gear.filter((g) => !category || g.category === category), [catalog.gear, category])
  return (
    <MasterDetail
      section="equipamentos"
      title="Equipamento de aventura"
      items={items}
      all={catalog.gear}
      selected={slug}
      filters={
        <select aria-label="Categoria" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Todas as categorias</option>
          {[...new Set(catalog.gear.map((g) => g.category))].sort().map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      }
      row={(g) => (
        <>
          <span>{g.name}</span>
          <span className="muted">{g.category} · {g.cost_display}</span>
        </>
      )}
      detail={(g) => (
        <article className="entry">
          <h2>{g.name}</h2>
          <p className="chips">
            <Chip>{g.category}</Chip>
            <Chip>{g.cost_display}</Chip>
            <Chip>{g.weight_lb} lb</Chip>
          </p>
          <Markdown>{g.description}</Markdown>
          {g.pack_contents.length > 0 && (
            <>
              <h4>Conteúdo</h4>
              <ul>
                {g.pack_contents.map((i) => (
                  <li key={i.item_slug}>
                    {i.quantity}× {i.item_name}
                  </li>
                ))}
              </ul>
            </>
          )}
        </article>
      )}
    />
  )
}

// ---------- Itens mágicos e monstros ----------

export function MagicItemsPage({ catalog, slug }: Props) {
  const { data, error } = useMagicItems()
  const [rarity, setRarity] = useState('')
  const [category, setCategory] = useState('')
  const [attune, setAttune] = useState('')
  const items = useMemo(
    () =>
      (data ?? []).filter(
        (i) => (!rarity || i.rarity === rarity) && (!category || i.item_category === category) && (!attune || i.requires_attunement === (attune === 'yes')),
      ),
    [data, rarity, category, attune],
  )
  if (error) return <Notice tone="error">{error}</Notice>
  if (!data) return <Loading what="os itens mágicos" />
  const categories = [...new Set(data.map((i) => i.item_category))].sort()
  return (
    <MasterDetail
      section="itens-magicos"
      title="Itens mágicos"
      items={items}
      all={data}
      selected={slug}
      pageSize={60}
      filters={
        <div className="filter-grid">
          <select aria-label="Raridade" value={rarity} onChange={(e) => setRarity(e.target.value)}>
            <option value="">Todas as raridades</option>
            {['Common', 'Uncommon', 'Rare', 'Very Rare', 'Legendary', 'Artifact'].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <select aria-label="Categoria" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Todas as categorias</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select aria-label="Sintonização" value={attune} onChange={(e) => setAttune(e.target.value)}>
            <option value="">Sintonização: qualquer</option>
            <option value="yes">Exige sintonização</option>
            <option value="no">Sem sintonização</option>
          </select>
        </div>
      }
      row={(i) => (
        <>
          <span>{i.name}</span>
          <span className="muted">
            {i.rarity} · {i.item_category}
          </span>
        </>
      )}
      detail={(i) => <MagicItemDetail item={i} catalog={catalog} />}
      intro={<p className="muted">{data.length} itens mágicos do SRD (inclui as variantes por tipo de arma e armadura). Use os filtros e a busca.</p>}
    />
  )
}

const CR_GROUPS: { label: string; min: number; max: number }[] = [
  { label: 'ND 0 a 1', min: 0, max: 1 },
  { label: 'ND 2 a 4', min: 2, max: 4 },
  { label: 'ND 5 a 10', min: 5, max: 10 },
  { label: 'ND 11 a 16', min: 11, max: 16 },
  { label: 'ND 17 ou mais', min: 17, max: 99 },
]

export function MonstersPage({ slug }: Omit<Props, 'catalog'>) {
  const { data, error } = useMonsters()
  const [type, setType] = useState('')
  const [group, setGroup] = useState('')
  const items = useMemo(() => {
    const range = CR_GROUPS.find((g) => g.label === group)
    return (data ?? [])
      .filter((m) => (!type || m.creature_type === type) && (!range || (m.cr_numeric >= range.min && m.cr_numeric <= range.max)))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [data, type, group])
  if (error) return <Notice tone="error">{error}</Notice>
  if (!data) return <Loading what="os monstros" />
  const types = [...new Set(data.map((m) => m.creature_type))].sort()
  return (
    <MasterDetail
      section="monstros"
      title="Monstros e animais"
      items={items}
      all={data}
      selected={slug}
      filters={
        <div className="filter-grid">
          <select aria-label="Tipo de criatura" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Todos os tipos</option>
            {types.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <select aria-label="Nível de Desafio" value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">Todos os ND</option>
            {CR_GROUPS.map((g) => (
              <option key={g.label}>{g.label}</option>
            ))}
          </select>
        </div>
      }
      row={(m) => (
        <>
          <span>{m.name}</span>
          <span className="muted">
            ND {m.challenge_rating} · {m.creature_type}
          </span>
        </>
      )}
      detail={(m) => <MonsterDetail monster={m} />}
      intro={<p className="muted">{data.length} criaturas do SRD 5.2.1, com fichas completas. Regras para usar monstros em <a href={bookHref('regras')}>Regras do jogo</a>.</p>}
    />
  )
}
