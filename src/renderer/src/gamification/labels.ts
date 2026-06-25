import { SPECIES } from '../../../shared/gamification/catalog'
import type { ServiceErrorCode } from '../../../shared/dto'
import type { PetView } from '../../../shared/dto'

/** Short, friendly copy for each domain error code surfaced from a ServiceResult. */
const ERROR_COPY: Record<ServiceErrorCode, string> = {
  'not-found': 'Sorry, that could not be found.',
  invalid: 'That action is not valid right now.',
  'insufficient-coins': 'Not enough coins yet — keep studying!',
  'egg-exists': 'You already have an egg incubating.',
  'no-pet': 'Hatch a pet first to give it a treat.',
  'already-owned': 'You already own this item.',
  'not-owned': 'You do not own this item yet.',
  'not-ready': 'This egg is not ready to hatch yet.',
  'name-too-long': 'That name is a little too long.',
  'deck-not-found': 'Sorry, that deck could not be found.',
  'card-not-found': 'Sorry, that card could not be found.',
  'deck-set-not-found': 'Sorry, that import could not be found.',
  'unsupported-format': 'That file format is not supported yet.',
  'corrupt-package': 'That file looks corrupted and could not be imported.',
  'import-too-large': 'That file is too large to import.'
}

export function errorMessage(code: ServiceErrorCode): string {
  return ERROR_COPY[code] ?? 'Something went wrong.'
}

/** The catalog display name for a species key (e.g. 'cat' → 'Calico Cat'). */
export function speciesName(speciesKey: string): string {
  return SPECIES.find((s) => s.key === speciesKey)?.name ?? speciesKey
}

/** A pet's chosen name, falling back to its species display name. */
export function petLabel(pet: PetView): string {
  return pet.name ?? speciesName(pet.species)
}
