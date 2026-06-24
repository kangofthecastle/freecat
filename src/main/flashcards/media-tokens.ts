// src/main/flashcards/media-tokens.ts
import { randomBytes } from 'node:crypto'

// Per-card capability tokens → deck-set id. Bounded, insertion-ordered eviction.
// A token authorizes ONLY its own deck-set's media (no global hash lookup).
const MAX_TOKENS = 256
const tokens = new Map<string, number>()

export function mintMediaToken(deckSetId: number): string {
  const token = randomBytes(16).toString('hex')
  tokens.set(token, deckSetId)
  while (tokens.size > MAX_TOKENS) {
    const oldest = tokens.keys().next().value
    if (oldest === undefined) break
    tokens.delete(oldest)
  }
  return token
}

export function resolveMediaToken(token: string): number | undefined {
  return tokens.get(token)
}

/** Test-only: clear all tokens. */
export function __resetMediaTokens(): void {
  tokens.clear()
}
