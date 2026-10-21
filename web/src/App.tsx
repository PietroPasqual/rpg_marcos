import { useCallback, useEffect, useState } from 'react'
import { loadCatalog } from './api/client'
import type { Catalog } from './api/types'
import { Builder, type BuilderStep } from './components/Builder'
import { Home } from './components/Home'
import { Notice } from './components/ui'
import { STEPS } from './domain/validation'

type Route = { name: 'home' } | { name: 'builder'; id: string; step: BuilderStep }

const STEP_IDS = new Set<string>([...STEPS.map((s) => s.id), 'sheet'])

function parseHash(): Route {
  const [kind, id, step] = location.hash.replace(/^#\/?/, '').split('/')
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
        <span className="muted">Regras de 2024 · SRD 5.2.1</span>
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
        {catalog && (route.name === 'home' ? <Home catalog={catalog} go={go} /> : <Builder key={route.id} catalog={catalog} id={route.id} step={route.step} go={go} />)}
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
