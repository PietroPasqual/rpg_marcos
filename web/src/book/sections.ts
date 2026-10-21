// Seções do Livro de Regras e como cada tipo de resultado da busca global leva até elas.

export interface BookSection {
  id: string
  label: string
  group: string
}

export const BOOK_SECTIONS: BookSection[] = [
  { id: 'regras', label: 'Regras do jogo', group: 'Regras' },
  { id: 'glossario', label: 'Glossário', group: 'Regras' },
  { id: 'classes', label: 'Classes', group: 'Personagem' },
  { id: 'especies', label: 'Espécies', group: 'Personagem' },
  { id: 'antecedentes', label: 'Antecedentes', group: 'Personagem' },
  { id: 'talentos', label: 'Talentos', group: 'Personagem' },
  { id: 'magias', label: 'Magias', group: 'Magias' },
  { id: 'armas', label: 'Armas', group: 'Equipamento' },
  { id: 'armaduras', label: 'Armaduras', group: 'Equipamento' },
  { id: 'ferramentas', label: 'Ferramentas', group: 'Equipamento' },
  { id: 'equipamentos', label: 'Equipamento de aventura', group: 'Equipamento' },
  { id: 'itens-magicos', label: 'Itens mágicos', group: 'Itens mágicos' },
  { id: 'monstros', label: 'Monstros e animais', group: 'Monstros' },
]

export const bookHref = (section: string, slug?: string): string => `#/livro/${section}${slug ? `/${slug}` : ''}`

export const PART_LABEL: Record<string, string> = {
  'Playing the Game': 'Como jogar',
  'Character Creation': 'Criação de personagem',
  Equipment: 'Equipamento',
  Spells: 'Conjuração de magias',
  'Gameplay Toolbox': 'Caixa de ferramentas do jogo',
  'Magic Items': 'Itens mágicos (regras)',
  Monsters: 'Monstros (regras)',
}

/** Seção do livro e slug para um resultado da busca global (/api/v1/search). */
export function searchResultHref(entityType: string, slug: string, parentOf: (slug: string) => string | undefined): string {
  switch (entityType) {
    case 'spells':
      return bookHref('magias', slug)
    case 'feats':
      return bookHref('talentos', slug)
    case 'classes':
      return bookHref('classes', slug)
    case 'subclasses':
      return bookHref('subclasses', slug)
    case 'class_feature_options':
      return bookHref('classes', parentOf(slug) ?? slug)
    case 'species':
      return bookHref('especies', slug)
    case 'backgrounds':
      return bookHref('antecedentes', slug)
    case 'weapons':
      return bookHref('armas', slug)
    case 'armor':
      return bookHref('armaduras', slug)
    case 'tools':
      return bookHref('ferramentas', slug)
    case 'gear':
      return bookHref('equipamentos', slug)
    case 'magic_items':
      return bookHref('itens-magicos', slug)
    case 'monsters':
      return bookHref('monstros', slug)
    default:
      return bookHref(slug.startsWith('book-') ? 'regras' : 'glossario', slug)
  }
}

export const ENTITY_LABEL: Record<string, string> = {
  spells: 'Magias',
  feats: 'Talentos',
  classes: 'Classes',
  subclasses: 'Subclasses',
  class_feature_options: 'Opções de classe',
  species: 'Espécies',
  backgrounds: 'Antecedentes',
  weapons: 'Armas',
  armor: 'Armaduras',
  tools: 'Ferramentas',
  gear: 'Equipamento',
  magic_items: 'Itens mágicos',
  monsters: 'Monstros',
  rules: 'Regras',
}
