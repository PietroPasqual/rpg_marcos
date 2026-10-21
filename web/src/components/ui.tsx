import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  )
}

export function Collapsible({ title, meta, children, open }: { title: ReactNode; meta?: ReactNode; children: ReactNode; open?: boolean }) {
  return (
    <details className="collapsible" open={open}>
      <summary>
        <span className="collapsible-title">{title}</span>
        {meta && <span className="collapsible-meta">{meta}</span>}
      </summary>
      <div className="collapsible-body">{children}</div>
    </details>
  )
}

export function Section({ title, hint, count, children }: { title: string; hint?: ReactNode; count?: { current: number; needed: number }; children: ReactNode }) {
  const done = count ? count.current === count.needed : false
  return (
    <section className="section">
      <header className="section-head">
        <h3>{title}</h3>
        {count && (
          <span className={`counter ${done ? 'counter-done' : count.current > count.needed ? 'counter-over' : ''}`} aria-live="polite">
            {count.current}/{count.needed}
          </span>
        )}
      </header>
      {hint && <p className="hint">{hint}</p>}
      {children}
    </section>
  )
}

export function Chip({ children, tone }: { children: ReactNode; tone?: 'accent' | 'good' | 'warn' | 'muted' }) {
  return <span className={`chip ${tone ? `chip-${tone}` : ''}`}>{children}</span>
}

export function OptionCard({
  selected,
  disabled,
  onClick,
  title,
  subtitle,
  children,
}: {
  selected: boolean
  disabled?: boolean
  onClick: () => void
  title: ReactNode
  subtitle?: ReactNode
  children?: ReactNode
}) {
  return (
    <button type="button" className={`option-card ${selected ? 'selected' : ''}`} aria-pressed={selected} disabled={disabled} onClick={onClick}>
      <span className="option-title">{title}</span>
      {subtitle && <span className="option-subtitle">{subtitle}</span>}
      {children}
    </button>
  )
}

export interface PickItem {
  value: string
  label: ReactNode
  hint?: ReactNode
  disabled?: boolean
  disabledReason?: string
}

/** Lista de checkboxes com limite de seleções. */
export function CheckList({ items, selected, limit, onChange, columns }: { items: PickItem[]; selected: string[]; limit: number; onChange: (next: string[]) => void; columns?: boolean }) {
  const full = selected.length >= limit
  return (
    <ul className={`checklist ${columns ? 'checklist-cols' : ''}`}>
      {items.map((item) => {
        const checked = selected.includes(item.value)
        const blocked = !checked && (full || item.disabled)
        return (
          <li key={item.value}>
            <label className={`check ${checked ? 'checked' : ''} ${blocked ? 'blocked' : ''}`} title={item.disabled ? item.disabledReason : undefined}>
              <input
                type="checkbox"
                checked={checked}
                disabled={blocked}
                onChange={() => onChange(checked ? selected.filter((v) => v !== item.value) : [...selected, item.value])}
              />
              <span className="check-label">{item.label}</span>
              {item.hint && <span className="check-hint">{item.hint}</span>}
            </label>
          </li>
        )
      })}
    </ul>
  )
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder = 'Escolha…',
}: {
  label: string
  value: string | null
  onChange: (value: string | null) => void
  options: { value: string; label: string; disabled?: boolean }[]
  placeholder?: string
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error'; children: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'note'}>
      {children}
    </div>
  )
}
