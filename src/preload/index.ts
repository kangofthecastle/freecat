import { contextBridge, ipcRenderer } from 'electron'
import { CH } from '../shared/channels'
import type { FreecatApi } from '../shared/api'

const api: FreecatApi = {
  profile: {
    get: () => ipcRenderer.invoke(CH.profileGet),
    setName: (name) => ipcRenderer.invoke(CH.profileSetName, name)
  },
  gamification: {
    getState: () => ipcRenderer.invoke(CH.gamGetState),
    recordActivity: (input) => ipcRenderer.invoke(CH.gamRecordActivity, input),
    buyEgg: () => ipcRenderer.invoke(CH.gamBuyEgg),
    buyTreat: () => ipcRenderer.invoke(CH.gamBuyTreat),
    buyItem: (itemKey) => ipcRenderer.invoke(CH.gamBuyItem, itemKey),
    hatchEgg: () => ipcRenderer.invoke(CH.gamHatchEgg),
    setActivePet: (petId) => ipcRenderer.invoke(CH.gamSetActivePet, petId),
    equipItem: (petId, itemKey) => ipcRenderer.invoke(CH.gamEquipItem, { petId, itemKey }),
    unequipItem: (petId, itemKey) => ipcRenderer.invoke(CH.gamUnequipItem, { petId, itemKey }),
    renamePet: (petId, name) => ipcRenderer.invoke(CH.gamRenamePet, { petId, name })
  },
  contentReview: {
    getOutline: () => ipcRenderer.invoke(CH.contentGetOutline),
    getLesson: (slug) => ipcRenderer.invoke(CH.contentGetLesson, slug),
    markViewed: (slug) => ipcRenderer.invoke(CH.contentMarkViewed, slug),
    markComplete: (slug, completed) => ipcRenderer.invoke(CH.contentMarkComplete, { slug, completed }),
    lessonForTaxonomy: (ref) => ipcRenderer.invoke(CH.contentLessonForTaxonomy, ref)
  },
  taxonomy: {
    list: () => ipcRenderer.invoke(CH.taxonomyList),
    tags: () => ipcRenderer.invoke(CH.taxonomyTags)
  },
  qbank: {
    startSession: (input) => ipcRenderer.invoke(CH.qbankStartSession, input),
    submitAnswer: (input) => ipcRenderer.invoke(CH.qbankSubmitAnswer, input),
    completeSession: (sessionId) => ipcRenderer.invoke(CH.qbankCompleteSession, sessionId),
    toggleFlag: (questionId) => ipcRenderer.invoke(CH.qbankToggleFlag, questionId),
    questionsForTaxonomy: (topicSlug) => ipcRenderer.invoke(CH.qbankQuestionsForTaxonomy, topicSlug)
  },
  stats: {
    overview: () => ipcRenderer.invoke(CH.statsOverview)
  },
  plan: {
    get: () => ipcRenderer.invoke(CH.planGet),
    saveSettings: (input) => ipcRenderer.invoke(CH.planSaveSettings, input),
    savePrefs: (prefs) => ipcRenderer.invoke(CH.planSavePrefs, prefs),
    setTaskStatus: (input) => ipcRenderer.invoke(CH.planSetTaskStatus, input),
    regenerate: () => ipcRenderer.invoke(CH.planRegenerate)
  },
  flashcards: {
    importDeck: () => ipcRenderer.invoke(CH.fcImportDeck),
    listDeckSets: () => ipcRenderer.invoke(CH.fcListDeckSets),
    listDecks: (deckSetId) => ipcRenderer.invoke(CH.fcListDecks, deckSetId),
    listCards: (input) => ipcRenderer.invoke(CH.fcListCards, input),
    getCard: (cardId) => ipcRenderer.invoke(CH.fcGetCard, cardId),
    deleteDeckSet: (deckSetId) => ipcRenderer.invoke(CH.fcDeleteDeckSet, deckSetId),
    reviewCounts: (deckId) => ipcRenderer.invoke(CH.fcReviewCounts, deckId),
    nextReviewCard: (deckId) => ipcRenderer.invoke(CH.fcNextReviewCard, deckId),
    reviewCard: (input) => ipcRenderer.invoke(CH.fcReviewCard, input)
  }
}
contextBridge.exposeInMainWorld('freecat', api)
