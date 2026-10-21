import { ALIGNMENTS } from '../../domain/srd'
import type { Character } from '../../domain/character'
import { SelectField } from '../ui'
import type { StepProps } from './types'

const TEXT_FIELDS: { key: keyof Pick<Character, 'appearance' | 'personality' | 'ideals' | 'bonds' | 'flaws' | 'backstory'>; label: string; rows: number }[] = [
  { key: 'appearance', label: 'Aparência', rows: 3 },
  { key: 'personality', label: 'Traços de personalidade', rows: 3 },
  { key: 'ideals', label: 'Ideais', rows: 2 },
  { key: 'bonds', label: 'Vínculos', rows: 2 },
  { key: 'flaws', label: 'Defeitos', rows: 2 },
  { key: 'backstory', label: 'História', rows: 6 },
]

export function DetailsStep({ character, change }: StepProps) {
  return (
    <div className="step">
      <h2>Detalhes do personagem</h2>
      <p className="lead">Dê vida ao seu personagem. Nada aqui altera as regras, mas tudo aparece na ficha.</p>
      <div className="field-row">
        <label className="field">
          <span className="field-label">Nome</span>
          <input type="text" value={character.name} maxLength={80} onChange={(e) => change((c) => ({ ...c, name: e.target.value }))} />
        </label>
        <SelectField label="Alinhamento" value={character.alignment || null} onChange={(v) => change((c) => ({ ...c, alignment: v ?? '' }))} options={ALIGNMENTS.map((a) => ({ value: a, label: a }))} />
      </div>
      {TEXT_FIELDS.map((f) => (
        <label className="field" key={f.key}>
          <span className="field-label">{f.label}</span>
          <textarea rows={f.rows} value={character[f.key]} onChange={(e) => change((c) => ({ ...c, [f.key]: e.target.value }))} />
        </label>
      ))}
    </div>
  )
}
