import { useState } from 'react'
import Home from './pages/Home'
import Nest from './pages/Nest'
import Qbank from './pages/Qbank'
import ContentReview from './pages/ContentReview'
import Flashcards from './pages/Flashcards'

const ROUTES = {
  home: { label: 'Home', component: Home },
  nest: { label: 'Nest', component: Nest },
  qbank: { label: 'Qbank', component: Qbank },
  content: { label: 'Content Review', component: ContentReview },
  flashcards: { label: 'Flashcards', component: Flashcards }
} as const

export type RouteKey = keyof typeof ROUTES

/** Optional deep-link target carried across a module switch (cross-links). */
export interface NavPayload {
  lessonSlug?: string
  topicSlug?: string
}

/** Pages may opt into navigation by accepting these props. */
export interface PageProps {
  navigate?: (key: RouteKey, payload?: NavPayload) => void
  navPayload?: NavPayload
}

export default function App(): React.JSX.Element {
  const [route, setRoute] = useState<RouteKey>('home')
  const [payload, setPayload] = useState<NavPayload | undefined>(undefined)
  const Active = ROUTES[route].component

  const navigate = (key: RouteKey, p?: NavPayload): void => {
    setRoute(key)
    setPayload(p)
  }

  return (
    <div className="flex h-screen">
      <nav className="w-48 bg-gray-100 p-4 space-y-1">
        <div className="text-lg font-bold text-blue-600 mb-4">FreeCAT</div>
        {(Object.keys(ROUTES) as RouteKey[]).map((key) => (
          <button
            key={key}
            onClick={() => navigate(key)}
            aria-current={route === key ? 'page' : undefined}
            className={`block w-full text-left px-3 py-2 rounded ${
              route === key ? 'bg-blue-600 text-white' : 'hover:bg-gray-200'
            }`}
          >
            {ROUTES[key].label}
          </button>
        ))}
      </nav>
      <main className="flex-1 overflow-auto">
        <Active navigate={navigate} navPayload={payload} />
      </main>
    </div>
  )
}
