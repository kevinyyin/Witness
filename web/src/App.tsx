import { useEffect, useState } from 'react'
import { IncidentPage } from './ui/IncidentPage'
import { OverviewPage } from './ui/OverviewPage'
import { BreakIt } from './ui/BreakIt'

/** Hash routes: #/ overview · #/incident/<id> · #/break · #/proof */
function useHashRoute(): string[] {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  const [parts, setParts] = useState(read)
  useEffect(() => {
    const on = () => setParts(read())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return parts
}

export default function App() {
  const [page, arg] = useHashRoute()
  return (
    <>
      <nav className="nav">
        <a href="#/" className={!page ? 'on' : ''}>overview</a>
        <a href="#/break" className={page === 'break' ? 'on' : ''}>break it</a>
        <a href="#/proof" className={page === 'proof' ? 'on' : ''}>proof</a>
      </nav>
      {page === 'incident' && arg ? <IncidentPage id={arg} key={arg} />
        : page === 'break' ? <BreakIt />
        : page === 'proof' ? <div className="page">Proof slide (V5)</div>
        : <OverviewPage />}
    </>
  )
}
