import type {
  ArmorData,
  BackgroundData,
  Catalog,
  ClassData,
  FeatData,
  FeatureOption,
  GearData,
  MagicItemData,
  MonsterData,
  Paginated,
  RuleData,
  RuleToc,
  SpeciesData,
  SpellData,
  SubclassData,
  ToolData,
  WeaponData,
  WeaponMasteryData,
} from './types'

// Em desenvolvimento o Vite encaminha /api para a API local (veja vite.config.ts).
// Em produção, defina VITE_API_BASE com a URL pública da API (ex.: https://api.meusite.com).
const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? ''

// Em hospedagem estática (GitHub Pages) não há API: o site lê os JSON gerados por scripts/export_static_site.py.
export const STATIC_DATA: boolean = import.meta.env.VITE_STATIC_DATA === '1'

async function staticJson<T>(file: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${import.meta.env.BASE_URL}data/${file}`)
  } catch {
    throw new ApiError('Não foi possível carregar os dados do site. Verifique a conexão e tente de novo.')
  }
  if (!response.ok) throw new ApiError(`Não foi possível carregar ${file} (${response.status}).`, response.status)
  return (await response.json()) as T
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

export async function getJson<T>(path: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, { headers: { Accept: 'application/json' } })
  } catch {
    throw new ApiError('Não foi possível conectar à API de catálogo. Ela está rodando em http://localhost:8000?')
  }
  if (!response.ok) {
    let detail = response.statusText
    try {
      detail = ((await response.json()) as { detail?: string }).detail ?? detail
    } catch {
      /* corpo sem JSON */
    }
    throw new ApiError(`A API respondeu ${response.status}: ${detail}`, response.status)
  }
  return (await response.json()) as T
}

/** Busca todas as páginas de uma listagem (100 itens por página). */
export async function getAll<T>(path: string): Promise<T[]> {
  const separator = path.includes('?') ? '&' : '?'
  const first = await getJson<Paginated<T>>(`${path}${separator}size=100&page=1`)
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, first.meta.pages - 1) }, (_, i) =>
      getJson<Paginated<T>>(`${path}${separator}size=100&page=${i + 2}`),
    ),
  )
  return [first, ...rest].flatMap((page) => page.items)
}

export async function loadCatalog(): Promise<Catalog> {
  if (STATIC_DATA) return staticJson<Catalog>('catalog.json')
  const [classes, subclasses, species, backgrounds, feats, spells, weapons, armor, tools, gear, masteries, featureOptions, about] =
    await Promise.all([
      getAll<ClassData>('/api/v1/classes'),
      getAll<SubclassData>('/api/v1/subclasses'),
      getAll<SpeciesData>('/api/v1/species'),
      getAll<BackgroundData>('/api/v1/backgrounds'),
      getAll<FeatData>('/api/v1/feats'),
      getAll<SpellData>('/api/v1/spells'),
      getAll<WeaponData>('/api/v1/equipment/weapons'),
      getAll<ArmorData>('/api/v1/equipment/armor'),
      getAll<ToolData>('/api/v1/equipment/tools'),
      getAll<GearData>('/api/v1/equipment/gear'),
      getJson<WeaponMasteryData[]>('/api/v1/equipment/weapon-masteries'),
      getAll<FeatureOption>('/api/v1/class-feature-options'),
      getJson<{ attribution: string; import_version: string }>('/api/v1/about'),
    ])
  return {
    classes,
    subclasses,
    species,
    backgrounds,
    feats,
    spells,
    weapons,
    armor,
    tools,
    gear,
    masteries,
    featureOptions,
    attribution: about.attribution,
    importVersion: about.import_version,
  }
}

// ---------- Livro de Regras ----------

export const loadMonsters = (): Promise<MonsterData[]> => (STATIC_DATA ? staticJson('monsters.json') : getAll<MonsterData>('/api/v1/monsters'))
export const loadMagicItems = (): Promise<MagicItemData[]> => (STATIC_DATA ? staticJson('magic-items.json') : getAll<MagicItemData>('/api/v1/magic-items'))
export const loadGlossary = (): Promise<RuleData[]> => (STATIC_DATA ? staticJson('glossary.json') : getAll<RuleData>('/api/v1/rules?book=false'))
export const loadRuleToc = (): Promise<RuleToc> => (STATIC_DATA ? staticJson('rules-toc.json') : getJson<RuleToc>('/api/v1/rules/toc'))

export async function loadRulePart(part: string): Promise<RuleData[]> {
  if (!STATIC_DATA) return getAll<RuleData>(`/api/v1/rules?part=${encodeURIComponent(part)}`)
  const book = await staticJson<Record<string, RuleData[]>>('rules-book.json')
  return book[part] ?? []
}

export interface SearchResult {
  entity_type: string
  slug: string
  name: string
  summary: string
}

export interface SearchResponse {
  query: string
  total_matches: number
  results_by_type: Record<string, SearchResult[]>
}

interface IndexEntry {
  t: string
  s: string
  n: string
  d: string
}

/** Busca global por nome (mesma regra de /api/v1/search): `limitPerType` resultados por tipo. */
export async function searchCatalog(query: string, limitPerType = 6): Promise<SearchResponse> {
  if (!STATIC_DATA) return getJson<SearchResponse>(`/api/v1/search?q=${encodeURIComponent(query)}&limit_per_type=${limitPerType}`)
  const term = query.trim().toLowerCase()
  const index = await staticJson<IndexEntry[]>('search-index.json')
  const results: Record<string, SearchResult[]> = {}
  let total = 0
  for (const e of index) {
    const bucket = (results[e.t] ??= [])
    if (bucket.length < limitPerType && e.n.toLowerCase().includes(term)) {
      bucket.push({ entity_type: e.t, slug: e.s, name: e.n, summary: e.d })
      total++
    }
  }
  for (const type of Object.keys(results)) if (results[type]!.length === 0) delete results[type]
  return { query: query.trim(), total_matches: total, results_by_type: results }
}
