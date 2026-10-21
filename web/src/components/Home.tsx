import { useRef, useState } from 'react'
import type { Catalog } from '../api/types'
import { newCharacter, type Character } from '../domain/character'
import { deleteCharacter, downloadCharacter, duplicateCharacter, importCharacterFile, loadCharacters, saveCharacter } from '../state/store'
import { Notice } from './ui'

export function Home({ catalog, go }: { catalog: Catalog; go: (path: string) => void }) {
  const [characters, setCharacters] = useState<Character[]>(() => loadCharacters())
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const refresh = () => setCharacters(loadCharacters())

  const create = () => {
    const character = newCharacter()
    saveCharacter(character)
    go(`/c/${character.id}/class`)
  }

  const onImport = async (file: File | undefined) => {
    if (!file) return
    try {
      const imported = await importCharacterFile(file)
      setError(null)
      go(`/c/${imported.id}/sheet`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível importar o arquivo.')
    }
    if (fileInput.current) fileInput.current.value = ''
  }

  const summary = (c: Character) => {
    const cls = catalog.classes.find((k) => k.slug === c.classSlug)
    const species = catalog.species.find((s) => s.slug === c.speciesSlug)
    return [cls ? `${cls.name} ${c.level}` : 'Sem classe', species?.name].filter(Boolean).join(' · ')
  }

  return (
    <div className="home">
      <div className="home-head">
        <div>
          <h1>Meus personagens</h1>
          <p className="lead">Crie fichas de D&amp;D 5e (regras de 2024) passo a passo. Elas ficam salvas neste navegador; exporte para guardar uma cópia.</p>
        </div>
        <div className="head-actions">
          <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(e) => onImport(e.target.files?.[0])} />
          <button type="button" className="btn btn-ghost" onClick={() => fileInput.current?.click()}>
            Importar JSON
          </button>
          <button type="button" className="btn" onClick={create}>
            + Novo personagem
          </button>
        </div>
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      {characters.length === 0 ? (
        <div className="empty">
          <p>Você ainda não criou nenhum personagem.</p>
          <button type="button" className="btn" onClick={create}>
            Criar meu primeiro personagem
          </button>
        </div>
      ) : (
        <ul className="character-list">
          {characters.map((c) => (
            <li key={c.id} className="character-card">
              <a href={`#/c/${c.id}/sheet`} className="character-main">
                <strong>{c.name || 'Personagem sem nome'}</strong>
                <span>{summary(c)}</span>
                <small className="muted">Atualizado em {new Date(c.updatedAt).toLocaleDateString('pt-BR')}</small>
              </a>
              <div className="card-actions">
                <a className="btn btn-sm btn-ghost" href={`#/c/${c.id}/class`}>
                  Editar
                </a>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    duplicateCharacter(c.id)
                    refresh()
                  }}
                >
                  Duplicar
                </button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => downloadCharacter(c)}>
                  Exportar
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  onClick={() => {
                    if (window.confirm(`Excluir ${c.name || 'este personagem'}? Isso não pode ser desfeito.`)) {
                      deleteCharacter(c.id)
                      refresh()
                    }
                  }}
                >
                  Excluir
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
