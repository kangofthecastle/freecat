export interface ParsedField { ord: number; name: string }
export interface ParsedTemplate { ord: number; name: string; qfmt: string; afmt: string }
export interface ParsedNoteType { ankiId: number; name: string; kind: 'standard' | 'cloze'; css: string; fields: ParsedField[]; templates: ParsedTemplate[] }
export interface ParsedDeck { ankiId: number; name: string }
export interface ParsedNote { ankiId: number; guid: string; noteTypeAnkiId: number; fields: string[]; tags: string[]; sortField: string }
export interface ParsedCard { noteAnkiId: number; deckAnkiId: number; ord: number }
export interface ParsedCollection { noteTypes: ParsedNoteType[]; decks: ParsedDeck[]; notes: ParsedNote[]; cards: ParsedCard[] }
