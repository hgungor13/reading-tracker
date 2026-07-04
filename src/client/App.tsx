import { useState } from 'react'
import { Home } from '@/screens/Home'
import { CreatePlan } from '@/screens/CreatePlan'
import { Join } from '@/screens/Join'
import { Dashboard } from '@/screens/Dashboard'
import { clearSession, getSession, setSession as persistSession, type Session } from '@/lib/session'

type Screen = 'home' | 'create' | 'join'

export function App() {
  const [session, setSession] = useState<Session | null>(() => getSession())
  const [screen, setScreen] = useState<Screen>('home')
  const [prefillCode, setPrefillCode] = useState('')

  // Open one of the reader's already-joined plans (from the home list).
  function openPlan(s: Session) {
    persistSession(s)
    setSession(s)
  }

  // A plan is open → straight to the dashboard.
  if (session) {
    return (
      <Dashboard
        session={session}
        onLeave={() => {
          // Close the plan but keep the identity so home still lists it.
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

  return (
    <Home
      onCreate={() => setScreen('create')}
      onJoin={() => setScreen('join')}
      onOpenPlan={openPlan}
    />
  )
}
