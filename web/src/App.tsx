import { useCallback, useEffect, useState } from 'react'
import { loadCatalog } from './api/client'
import type { Catalog } from './api/types'
import { BookApp } from './book/BookApp'
import { accountsEnabled } from './api/accounts'
import { Account } from './components/Account'
import { Builder, type BuilderStep } from './components/Builder'
import { Home } from './components/Home'
import { Notice } from './components/ui'
import { STEPS } from './domain/validation'
import { startAutoSync, useSession, useSyncState } from './state/sync'

type Route = { name: 'home' } | { name: 'account' } | { name: 'builder'; id: string; step: BuilderStep } | { name: 'book'; segments: string[] }

const STEP_IDS = new Set<string>([...STEPS.map((s) => s.id), 'sheet'])

function parseHash(): Route {
  const [kind, id, step] = location.hash.replace(/^#\/?/, '').split('/')
  if (kind === 'livro') return { name: 'book', segments: location.hash.replace(/^#\/?livro\/?/, '').split('/').filter(Boolean).map(decodeURIComponent) }
  if (kind === 'conta' && accountsEnabled) return { name: 'account' }
  if (kind === 'c' && id) return { name: 'builder', id, step: STEP_IDS.has(step ?? '') ? (step as BuilderStep) : 'class' }
  return { name: 'home' }
}

function useRoute(): [Route, (path: string) => void] {
  const [route, setRoute] = useState<Route>(parseHash)
  useEffect(() => {
    const onChange = () => setRoute(parseHash())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  const go = useCallback((path: string) => {
    location.hash = path
  }, [])
  return [route, go]
}

export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [route, go] = useRoute()
  const session = useSession()
  const sync = useSyncState()

  useEffect(() => startAutoSync(), [])

  useEffect(() => {
    let cancelled = false
    setError(null)
    loadCatalog()
      .then((loaded) => !cancelled && setCatalog(loaded))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : 'Erro ao carregar o catálogo.'))
    return () => {
      cancelled = true
    }
  }, [attempt])

  return (
    <div className="app">
      <header className="app-bar no-print">
        <a href="#/" className="brand">
          <span aria-hidden="true">⚔</span> Montador de Ficha D&amp;D 5e
        </a>
        <nav className="app-nav" aria-label="Principal">
          <a href="#/" className={route.name === 'home' || route.name === 'builder' ? 'active' : ''}>
            Fichas
          </a>
          <a href="#/livro" className={route.name === 'book' ? 'active' : ''}>
            Livro de Regras
          </a>
          {accountsEnabled && (
            <a href="#/conta" className={`account-link ${route.name === 'account' ? 'active' : ''}`} title={session ? `Conectado como ${session.email}` : 'Entrar para sincronizar'}>
              {session ? (
                <>
                  <span className={`sync-dot sync-${sync.phase}`} aria-hidden="true" />
                  <span className="sr-only">Sincronização: {sync.phase === 'syncing' ? 'em andamento' : sync.phase === 'error' ? 'com erro' : 'em dia'}. </span>
                  Conta
                </>
              ) : (
                'Entrar'
              )}
            </a>
          )}
        </nav>
      </header>
      <div className="app-content">
        {error && (
          <Notice tone="error">
            {error}{' '}
            <button type="button" className="btn btn-sm" onClick={() => setAttempt((n) => n + 1)}>
              Tentar de novo
            </button>
          </Notice>
        )}
        {!catalog && !error && (
          <div className="loading" role="status">
            <div className="spinner" aria-hidden="true" />
            Carregando o catálogo de regras…
          </div>
        )}
        {route.name === 'account' && <Account />}
        {catalog && route.name === 'home' && <Home catalog={catalog} go={go} />}
        {catalog && route.name === 'builder' && <Builder key={route.id} catalog={catalog} id={route.id} step={route.step} go={go} />}
        {catalog && route.name === 'book' && <BookApp catalog={catalog} segments={route.segments} />}
      </div>
      <footer className="app-foot no-print">
        <small>
          Este trabalho inclui material do System Reference Document 5.2.1 (“SRD 5.2.1”) da Wizards of the Coast LLC, disponível em{' '}
          <a href="https://www.dndbeyond.com/srd" target="_blank" rel="noreferrer">
            dndbeyond.com/srd
          </a>
          , licenciado sob{' '}
          <a href="https://creativecommons.org/licenses/by/4.0/legalcode" target="_blank" rel="noreferrer">
            Creative Commons Attribution 4.0
          </a>
          . Compatível com a quinta edição.
        </small>
      </footer>
    </div>
  )
}
