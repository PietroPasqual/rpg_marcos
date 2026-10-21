import type { Catalog } from '../../api/types'
import type { Character } from '../../domain/character'
import type { Derived } from '../../domain/derive'

export interface StepProps {
  character: Character
  derived: Derived
  catalog: Catalog
  change: (mutate: (character: Character) => Character) => void
}
