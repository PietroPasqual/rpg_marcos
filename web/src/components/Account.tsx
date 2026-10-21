import { useEffect, useState, type FormEvent } from 'react'
import { AccountsError, accountsApi } from '../api/accounts'
import { signIn, signOut, syncNow, useSyncState } from '../state/sync'
import { useSession } from '../state/session'
import { Notice, Section } from './ui'

const formatTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'ainda não')

function errorText(e: unknown): string {
  if (e instanceof AccountsError) return e.retryAfter ? `${e.message} (tente de novo em ${Math.ceil(e.retryAfter / 60)} min)` : e.message
  return e instanceof Error ? e.message : 'Algo deu errado.'
}

function AuthForms() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [registration, setRegistration] = useState<{ open: boolean; min: number } | null>(null)
  const sync = useSyncState()

  useEffect(() => {
    accountsApi
      .status()
      .then((s) => setRegistration({ open: s.registration_open, min: s.min_password_length }))
      .catch((e: unknown) => setError(errorText(e)))
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    if (mode === 'register' && password !== confirm) {
      setError('As senhas não conferem.')
      return
    }
    setBusy(true)
    try {
      const session = mode === 'login' ? await accountsApi.login(email, password) : await accountsApi.register(email, password)
      await signIn({ token: session.access_token, email: session.user.email })
      location.hash = '#/'
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {sync.error && <Notice tone="warn">{sync.error}</Notice>}
      <div className="segmented" role="group" aria-label="Entrar ou criar conta">
        <button type="button" aria-pressed={mode === 'login'} onClick={() => setMode('login')}>
          Entrar
        </button>
        <button type="button" aria-pressed={mode === 'register'} onClick={() => setMode('register')} disabled={registration?.open === false}>
          Criar conta
        </button>
      </div>
      {registration?.open === false && <p className="hint">Novos cadastros estão fechados neste servidor.</p>}
      <form className="account-form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">E-mail</span>
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Senha{mode === 'register' && registration ? ` (mínimo ${registration.min} caracteres)` : ''}</span>
          <input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'register' ? registration?.min : undefined} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {mode === 'register' && (
          <label className="field">
            <span className="field-label">Repita a senha</span>
            <input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </label>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        <button type="submit" className="btn" disabled={busy}>
          {busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta'}
        </button>
      </form>
      <p className="muted">
        As fichas continuam funcionando sem conta, só neste navegador. Ao entrar, as fichas deste navegador são enviadas para a sua conta e as da conta aparecem aqui. Não há recuperação de senha: guarde a sua.
      </p>
    </>
  )
}

function Manage({ email, token }: { email: string; token: string }) {
  const sync = useSyncState()
  const [notice, setNotice] = useState<{ tone: 'error' | 'warn'; text: string } | null>(null)
  const [wipe, setWipe] = useState(false)
  const [passwords, setPasswords] = useState({ current: '', next: '' })
  const [deletePassword, setDeletePassword] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  const run = async (action: () => Promise<void>) => {
    setNotice(null)
    setDone(null)
    try {
      await action()
    } catch (e) {
      setNotice({ tone: 'error', text: errorText(e) })
    }
  }

  const changePassword = (event: FormEvent) => {
    event.preventDefault()
    void run(async () => {
      const session = await accountsApi.changePassword(token, passwords.current, passwords.next)
      await signIn({ token: session.access_token, email: session.user.email })
      setPasswords({ current: '', next: '' })
      setDone('Senha alterada. Os outros aparelhos precisarão entrar de novo.')
    })
  }

  return (
    <>
      <Section title="Sincronização">
        <p>
          Conectado como <strong>{email}</strong>.
        </p>
        <p className="muted" aria-live="polite">
          {sync.phase === 'syncing' ? 'Sincronizando…' : sync.phase === 'error' ? `Erro: ${sync.error}` : `Última sincronização: ${formatTime(sync.lastSyncedAt)}`}
        </p>
        <p>
          <button type="button" className="btn" disabled={sync.phase === 'syncing'} onClick={() => void syncNow()}>
            Sincronizar agora
          </button>
        </p>
        <p className="muted">Se a mesma ficha foi editada em dois aparelhos, vale a edição mais recente.</p>
      </Section>

      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {done && <Notice>{done}</Notice>}

      <Section title="Sair">
        <label className="toggle">
          <input type="checkbox" checked={wipe} onChange={(e) => setWipe(e.target.checked)} />
          <span>Apagar também as fichas deste navegador (use em computadores compartilhados)</span>
        </label>
        <p>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              signOut(wipe)
              location.hash = '#/'
            }}
          >
            Sair da conta
          </button>{' '}
          <button type="button" className="btn btn-ghost" onClick={() => void run(async () => { await accountsApi.logoutAll(token); signOut(false); location.hash = '#/conta' })}>
            Sair em todos os aparelhos
          </button>
        </p>
      </Section>

      <Section title="Trocar senha">
        <form className="account-form" onSubmit={changePassword}>
          <label className="field">
            <span className="field-label">Senha atual</span>
            <input type="password" autoComplete="current-password" required value={passwords.current} onChange={(e) => setPasswords((p) => ({ ...p, current: e.target.value }))} />
          </label>
          <label className="field">
            <span className="field-label">Nova senha</span>
            <input type="password" autoComplete="new-password" required minLength={8} value={passwords.next} onChange={(e) => setPasswords((p) => ({ ...p, next: e.target.value }))} />
          </label>
          <button type="submit" className="btn btn-ghost">
            Trocar senha
          </button>
        </form>
      </Section>

      <Section title="Excluir conta" hint="Apaga a conta e todas as fichas guardadas no servidor. As cópias deste navegador continuam aqui.">
        {!confirmDelete ? (
          <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
            Excluir minha conta…
          </button>
        ) : (
          <form
            className="account-form"
            onSubmit={(e) => {
              e.preventDefault()
              void run(async () => {
                await accountsApi.deleteAccount(token, deletePassword)
                signOut(false)
                location.hash = '#/'
              })
            }}
          >
            <label className="field">
              <span className="field-label">Digite sua senha para confirmar</span>
              <input type="password" autoComplete="current-password" required value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} />
            </label>
            <p>
              <button type="submit" className="btn btn-danger">
                Excluir definitivamente
              </button>{' '}
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
                Cancelar
              </button>
            </p>
          </form>
        )}
      </Section>
    </>
  )
}

export function Account() {
  const session = useSession()
  return (
    <div className="account">
      <h1>Conta</h1>
      <p className="lead">Entre para guardar suas fichas na nuvem e abri-las em qualquer aparelho.</p>
      {session ? <Manage email={session.email} token={session.token} /> : <AuthForms />}
    </div>
  )
}
