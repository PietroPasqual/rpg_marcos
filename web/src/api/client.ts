import type {
  ArmorData,
  BackgroundData,
  Catalog,
  ClassData,
  FeatData,
  FeatureOption,
  GearData,
  Paginated,
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
