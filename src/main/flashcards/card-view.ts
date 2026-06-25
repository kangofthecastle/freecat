// src/main/flashcards/card-view.ts
import type { CardView } from '../../shared/dto'
import type { CardSource } from '../repositories/flashcards'

export function mediaUrl(token: string, filename: string): string {
  return `freecat-media://${token}/${encodeURIComponent(filename)}`
}

/** Map the internal CardSource to the renderer-facing CardView, minting tokenized
 *  media URLs and dropping the deck-set id + content hashes. */
export function toCardView(source: CardSource, token: string): CardView {
  return {
    cardId: source.cardId,
    renderKind: source.renderKind,
    css: source.css,
    qfmt: source.qfmt,
    afmt: source.afmt,
    fields: source.fields,
    tags: source.tags,
    noteTypeName: source.noteTypeName,
    deckName: source.deckName,
    subdeckName: source.subdeckName,
    templateName: source.templateName,
    clozeOrdinal: source.clozeOrdinal,
    mediaMap: source.media.map((m) => ({ filename: m.filename, url: mediaUrl(token, m.filename) }))
  }
}
