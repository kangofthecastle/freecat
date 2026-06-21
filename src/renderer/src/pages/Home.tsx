import { useEffect, useState } from 'react'

export default function Home(): React.JSX.Element {
  const [name, setName] = useState<string>('…')

  useEffect(() => {
    window.freecat.profile
      .get()
      .then((p) => setName(p.displayName))
      .catch((err) => {
        console.error('Failed to load profile', err)
        setName('Student')
      })
  }, [])

  return (
    <div className="p-8">
      <h2 className="text-2xl font-bold">Welcome back, {name}</h2>
      <p className="text-gray-500 mt-2">Your study dashboard will live here.</p>
    </div>
  )
}
