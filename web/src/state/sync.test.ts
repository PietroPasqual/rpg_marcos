import { describe, expect, it } from 'vitest'
import { AccountsError } from '../api/accounts'
import { newCharacter, type Character } from '../domain/character'
import { planSync, runSync, type Remote, type SyncDeps } from './sync'

const char = (id: string, updatedAt: string, name = id): Character => ({ ...newCharacter(), id, name, updatedAt })
const live = (c: Character): Remote => ({ id: c.id, data: c, updatedAt: c.updatedAt, deleted: false })
const gone = (id: string, updatedAt: string): Remote => ({ id, data: null, updatedAt, deleted: true })
const T = (n: number) => `2026-01-0${n}T10:00:00.000Z`

describe('planSync', () => {
  it('envia o que só existe aqui e traz o que só existe lá', () => {
    const actions = planSync([char('a', T(1))], {}, [live(char('b', T(1)))])
    expect(actions.map((a) => a.kind).sort()).toEqual(['pull', 'push'])
  })

  it('a versão mais recente vence; empate não faz nada', () => {
    expect(planSync([char('a', T(2))], {}, [live(char('a', T(1)))])).toMatchObject([{ kind: 'push' }])
    expect(planSync([char('a', T(1))], {}, [live(char('a', T(2)))])).toMatchObject([{ kind: 'pull' }])
    expect(planSync([char('a', T(1))], {}, [live(char('a', T(1)))])).toEqual([])
  })

  it('exclusão local vai para o servidor e o marcador some quando o servidor já sabe', () => {
    expect(planSync([], { a: T(3) }, [live(char('a', T(1)))])).toEqual([{ kind: 'push-delete', id: 'a', deletedAt: T(3) }])
    expect(planSync([], { a: T(3) }, [])).toEqual([{ kind: 'push-delete', id: 'a', deletedAt: T(3) }])
    expect(planSync([], { a: T(3) }, [gone('a', T(3))])).toEqual([{ kind: 'clear-tombstone', id: 'a' }])
  })

  it('edição no servidor depois da exclusão local ressuscita a ficha aqui', () => {
    const edited = char('a', T(5))
    expect(planSync([], { a: T(3) }, [live(edited)])).toEqual([{ kind: 'pull', character: edited, clearTombstone: true }])
  })

  it('exclusão remota apaga a cópia local não editada depois dela; uma edição mais nova ressuscita no servidor', () => {
    expect(planSync([char('a', T(1))], {}, [gone('a', T(2))])).toEqual([{ kind: 'remove-local', id: 'a' }])
    expect(planSync([char('a', T(4))], {}, [gone('a', T(2))])).toMatchObject([{ kind: 'push' }])
    expect(planSync([], {}, [gone('a', T(2))])).toEqual([])
  })

  it('ficha editada depois de excluída localmente descarta o marcador', () => {
    const actions = planSync([char('a', T(5))], { a: T(3) }, [live(char('a', T(1)))])
    expect(actions.map((a) => a.kind).sort()).toEqual(['clear-tombstone', 'push'])
  })
})

function fake(local: Character[], remote: Remote[], tombstones: Record<string, string> = {}) {
  const store = { local: [...local], remote: [...remote], tombstones: { ...tombstones }, puts: [] as string[], removes: [] as string[] }
  const deps: SyncDeps = {
    list: async () => store.remote,
    put: async (c) => {
      store.puts.push(c.id)
      store.remote = [...store.remote.filter((r) => r.id !== c.id), live(c)]
    },
    remove: async (id, at) => {
      store.removes.push(id)
      store.remote = [...store.remote.filter((r) => r.id !== id), gone(id, at)]
    },
    readLocal: () => store.local,
    readTombstones: () => store.tombstones,
    writeLocal: (c) => void (store.local = [...store.local.filter((x) => x.id !== c.id), c]),
    removeLocal: (id) => void (store.local = store.local.filter((x) => x.id !== id)),
    writeTombstones: (t) => void (store.tombstones = t),
  }
  return { store, deps }
}

describe('runSync', () => {
  it('deixa os dois lados iguais e uma segunda rodada não faz nada', async () => {
    const { store, deps } = fake([char('a', T(2)), char('c', T(1))], [live(char('a', T(1))), live(char('b', T(3)))])
    const first = await runSync(deps)
    expect(first).toMatchObject({ pushed: 2, pulled: 1 })
    expect(store.local.map((c) => c.id).sort()).toEqual(['a', 'b', 'c'])
    expect(store.remote.map((r) => r.id).sort()).toEqual(['a', 'b', 'c'])
    expect(await runSync(deps)).toEqual({ pushed: 0, pulled: 0, removed: 0, conflicts: 0 })
  })

  it('propaga exclusões entre dois aparelhos', async () => {
    const a = fake([char('x', T(1))], [])
    await runSync(a.deps) // aparelho A envia
    const b = fake([], a.store.remote)
    await runSync(b.deps) // aparelho B recebe
    expect(b.store.local.map((c) => c.id)).toEqual(['x'])
    a.store.local = []
    a.store.tombstones = { x: T(4) } // A exclui
    await runSync(a.deps)
    expect(a.store.tombstones).toEqual({})
    b.store.remote = a.store.remote
    expect((await runSync(b.deps)).removed).toBe(1) // B apaga
    expect(b.store.local).toEqual([])
  })

  it('conflito 409 não derruba o ciclo e é contado', async () => {
    const { deps } = fake([char('a', T(2)), char('b', T(2))], [live(char('a', T(1))), live(char('b', T(1)))])
    let calls = 0
    deps.put = async () => {
      calls++
      if (calls === 1) throw new AccountsError('mais recente no servidor', 409)
    }
    expect(await runSync(deps)).toMatchObject({ pushed: 1, conflicts: 1 })
  })

  it('outros erros (offline, 401) interrompem e chegam a quem chamou', async () => {
    const { deps } = fake([char('a', T(2))], [])
    deps.put = async () => {
      throw new AccountsError('sem rede', undefined, true)
    }
    await expect(runSync(deps)).rejects.toMatchObject({ offline: true })
    deps.list = async () => {
      throw new AccountsError('expirou', 401)
    }
    await expect(runSync(deps)).rejects.toMatchObject({ status: 401 })
  })
})
