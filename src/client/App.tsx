import { useState } from 'react'
import { Home } from '@/screens/Home'
import { CreatePlan } from '@/screens/CreatePlan'
import { Join } from '@/screens/Join'
import { Dashboard } from '@/screens/Dashboard'
import { clearSession, getSession, type Session } from '@/lib/session'

type Screen = 'home' | 'create' | 'join'

export function App() {
  const [session, setSession] = useState<Session | null>(() => getSession())
  const [screen, setScreen] = useState<Screen>('home')
  const [prefillCode, setPrefillCode] = useState('')

  // Logged in (joined a plan) → straight to the dashboard.
  if (session) {
    return (
      <Dashboard
        session={session}
        onLeave={() => {
          clearSession()
          setSession(null)
          setScreen('home')
        }}
      />
    )
  }

  if (screen === 'create') {
    return (
      <CreatePlan
        onBack={() => setScreen('home')}
        onCreated={(code) => {
          setPrefillCode(code)
          setScreen('join')
        }}
      />
    )
  }

  if (screen === 'join') {
    return (
      <Join
        prefillCode={prefillCode}
        onBack={() => {
          setPrefillCode('')
          setScreen('home')
        }}
        onJoined={(s) => setSession(s)}
      />
    )
  }

  return <Home onCreate={() => setScreen('create')} onJoin={() => setScreen('join')} />
}
