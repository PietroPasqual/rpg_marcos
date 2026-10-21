import type { Catalog } from '../api/types'
import { Notice } from '../components/ui'
import { BookSearch } from './BookSearch'
import { ArmorPage, BackgroundsPage, ClassesPage, FeatsPage, GearPage, MagicItemsPage, MonstersPage, SpeciesPage, SpellsPage, SubclassesPage, ToolsPage, WeaponsPage } from './pages/CatalogPages'
import { GlossaryPage } from './pages/GlossaryPage'
import { RulesReader } from './pages/RulesReader'
import { BOOK_SECTIONS, bookHref } from './sections'

const GROUPS = [...new Set(BOOK_SECTIONS.map((s) => s.group))]

function BookHome() {
  return (
    <div className="book-home">
      <h2>Livro de Regras</h2>
      <p className="lead">
        O SRD 5.2.1 completo em português na interface (textos em inglês, como na fonte): regras, classes, espécies, magias, equipamento, itens mágicos e monstros.
        Use a busca no topo para achar qualquer coisa.
      </p>
      {GROUPS.map((group) => (
        <section key={group}>
          <h3>{group}</h3>
          <div className="card-grid card-grid-sm">
            {BOOK_SECTIONS.filter((s) => s.group === group).map((s) => (
              <a key={s.id} className="part-card book-card" href={bookHref(s.id)}>
                {s.label}
              </a>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function Section({ id, slug, catalog }: { id: string; slug?: string; catalog: Catalog }) {
  switch (id) {
    case 'regras':
      return <RulesReader slug={slug} />
    case 'glossario':
      return <GlossaryPage slug={slug} />
    case 'classes':
      return <ClassesPage catalog={catalog} slug={slug} />
    case 'subclasses':
      return <SubclassesPage catalog={catalog} slug={slug} />
    case 'especies':
      return <SpeciesPage catalog={catalog} slug={slug} />
    case 'antecedentes':
      return <BackgroundsPage catalog={catalog} slug={slug} />
    case 'talentos':
      return <FeatsPage catalog={catalog} slug={slug} />
    case 'magias':
      return <SpellsPage catalog={catalog} slug={slug} />
    case 'armas':
      return <WeaponsPage catalog={catalog} slug={slug} />
    case 'armaduras':
      return <ArmorPage catalog={catalog} slug={slug} />
    case 'ferramentas':
      return <ToolsPage catalog={catalog} slug={slug} />
    case 'equipamentos':
      return <GearPage catalog={catalog} slug={slug} />
    case 'itens-magicos':
      return <MagicItemsPage catalog={catalog} slug={slug} />
    case 'monstros':
      return <MonstersPage slug={slug} />
    default:
      return (
        <Notice tone="warn">
          Seção desconhecida. <a href={bookHref('')}>Voltar ao início do livro</a>
        </Notice>
      )
  }
}

export function BookApp({ catalog, segments }: { catalog: Catalog; segments: string[] }) {
  const [id, slug] = segments
  const current = id === 'subclasses' ? 'classes' : id
  return (
    <div className="book">
      <nav className="book-nav no-print" aria-label="Seções do livro">
        <a href={bookHref('')} className={!id ? 'active' : ''}>
          Início
        </a>
        {BOOK_SECTIONS.map((s) => (
          <a key={s.id} href={bookHref(s.id)} className={s.id === current ? 'active' : ''} aria-current={s.id === current ? 'page' : undefined}>
            {s.label}
          </a>
        ))}
      </nav>
      <BookSearch catalog={catalog} />
      {id ? <Section key={id} id={id} slug={slug} catalog={catalog} /> : <BookHome />}
    </div>
  )
}
