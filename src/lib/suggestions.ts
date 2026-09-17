import type { Thing, ThingKind } from './types.ts'

/**
 * Classification suggestions — the seam for a future model.
 *
 * Milestone 001 ships NO suggestion engine. Keyword matching would not be
 * intelligence, and presenting it as such would be a lie, so `suggestionEngine`
 * is null and the routing interface simply renders nothing where suggestions
 * would go. Dropping in a real engine later means implementing this interface
 * and assigning it here; no UI rewrite is required.
 */
export interface KindSuggestion {
  kind: ThingKind
  /** 0..1 — shown to the user, never used to auto-apply a classification. */
  confidence: number
  /** Why the engine thinks so, in the engine's own words. */
  rationale: string
}

export interface SuggestionEngine {
  id: string
  /** Shown in the UI so the user always knows what produced a suggestion. */
  label: string
  suggest(things: Thing[]): Promise<Map<string, KindSuggestion[]>>
}

export const suggestionEngine: SuggestionEngine | null = null
