import type { Ability, Catalog, FeatData } from '../../api/types'
import { patchFeat, setFeat } from '../../domain/actions'
import type { Character } from '../../domain/character'
import { featPickIssues, fixedMagicInitiateList, featsForSlot, MAGIC_INITIATE_LISTS, unmetPrerequisite } from '../../domain/feats'
import type { FeatSlot } from '../../domain/plan'
import { lookup } from '../../domain/lookup'
import { classSpells } from '../../domain/spells'
import { ABILITIES, ABILITY_LABEL, SKILLS } from '../../domain/srd'
import type { Derived } from '../../domain/derive'
import { CheckList, Collapsible, Markdown, SelectField } from '../ui'

interface Props {
  slot: FeatSlot
  character: Character
  derived: Derived
  catalog: Catalog
  change: (mutate: (character: Character) => Character) => void
}

const abilityOptions = (allowed: Ability[]) => allowed.map((a) => ({ value: a, label: ABILITY_LABEL[a] }))

export function FeatSlotEditor({ slot, character, derived, catalog, change }: Props) {
  const look = lookup(catalog)
  const pick = character.feats[slot.key]
  const slug = slot.fixedSlug ?? pick?.slug ?? null
  const feat = slug ? look.feats.get(slug) : undefined
  const totals = Object.fromEntries(ABILITIES.map((a) => [a, derived.scores[a].total])) as Record<Ability, number>
  const eligible = featsForSlot(slot, catalog.feats, character.level)
  const issues = featPickIssues(pick && { ...pick, slug }, feat, fixedMagicInitiateList(slot, derived.plan.background))

  const choose = (value: string | null) => {
    if (!value) return change((c) => setFeat(c, slot.key, null))
    const base = { slug: value }
    change((c) =>
      setFeat(
        c,
        slot.key,
        value === 'ability-score-improvement'
          ? { ...base, asi: { mode: 'plus2', first: null, second: null } }
          : value === 'magic-initiate'
            ? { ...base, magicInitiate: { list: fixedMagicInitiateList(slot, derived.plan.background), ability: null, cantrips: [], spell: null } }
            : base,
      ),
    )
  }
  const patch = (p: Parameters<typeof patchFeat>[2]) => change((c) => patchFeat(c, slot.key, p))
  const featureTitle = slot.fixedSlug ? `${slot.label}: ${feat?.name ?? slot.fixedSlug}` : slot.label

  return (
    <div className={`feat-slot ${issues.length === 0 && slug ? 'feat-ok' : ''}`}>
      <h4>{featureTitle}</h4>

      {!slot.fixedSlug && (
        <SelectField
          label="Talento"
          value={slug}
          onChange={choose}
          options={eligible.map((f: FeatData) => {
            const unmet = unmetPrerequisite(f, totals)
            return { value: f.slug, label: unmet ? `${f.name} (${unmet})` : f.name }
          })}
        />
      )}

      {feat && (
        <Collapsible title={`Sobre ${feat.name}`} meta={feat.prerequisite_text ?? undefined}>
          {feat.description && <Markdown>{feat.description}</Markdown>}
          {feat.benefits.map((b) => (
            <Markdown key={b.name}>{`**${b.name}.** ${b.description}`}</Markdown>
          ))}
        </Collapsible>
      )}

      {slug === 'ability-score-improvement' && pick?.asi && (
        <div className="choice-box">
          <div className="segmented" role="group" aria-label="Distribuição do aumento">
            <button type="button" aria-pressed={pick.asi.mode === 'plus2'} onClick={() => patch({ asi: { ...pick.asi!, mode: 'plus2', second: null } })}>
              +2 em um atributo
            </button>
            <button type="button" aria-pressed={pick.asi.mode === 'plus1x2'} onClick={() => patch({ asi: { ...pick.asi!, mode: 'plus1x2' } })}>
              +1 em dois atributos
            </button>
          </div>
          <div className="field-row">
            <SelectField label={pick.asi.mode === 'plus2' ? '+2 em' : '+1 em'} value={pick.asi.first} onChange={(v) => patch({ asi: { ...pick.asi!, first: v as Ability | null } })} options={abilityOptions(ABILITIES)} />
            {pick.asi.mode === 'plus1x2' && (
              <SelectField
                label="+1 em"
                value={pick.asi.second}
                onChange={(v) => patch({ asi: { ...pick.asi!, second: v as Ability | null } })}
                options={ABILITIES.filter((a) => a !== pick.asi!.first).map((a) => ({ value: a, label: ABILITY_LABEL[a] }))}
              />
            )}
          </div>
        </div>
      )}

      {feat && slug !== 'ability-score-improvement' && feat.ability_score_increase_options.length > 0 && (
        <SelectField label={`Aumento de atributo (+1${slot.category === 'Epic Boon' ? ', máximo 30' : ', máximo 20'})`} value={pick?.ability ?? null} onChange={(v) => patch({ ability: v as Ability | null })} options={abilityOptions(feat.ability_score_increase_options)} />
      )}

      {slug === 'magic-initiate' && pick && <MagicInitiateEditor pick={pick.magicInitiate} fixedList={fixedMagicInitiateList(slot, derived.plan.background)} catalog={catalog} onChange={(magicInitiate) => patch({ magicInitiate })} />}

      {slug === 'skilled' && (
        <div className="choice-box">
          <p className="hint">Escolha 3 perícias ou ferramentas em que você passa a ter proficiência.</p>
          <CheckList
            columns
            limit={3}
            selected={pick?.skilled ?? []}
            onChange={(skilled) => patch({ skilled })}
            items={[
              ...SKILLS.map((s) => ({ value: s.name, label: s.name, hint: s.label, disabled: derived.skills.find((k) => k.name === s.name)!.level !== 'none' && !(pick?.skilled ?? []).includes(s.name), disabledReason: 'Você já tem proficiência' })),
              ...catalog.tools.map((t) => ({ value: t.slug, label: t.name, hint: 'ferramenta' })),
            ]}
          />
        </div>
      )}

      {issues.length > 0 && slug && <p className="pending">Falta: {issues.join('; ')}.</p>}
    </div>
  )
}

function MagicInitiateEditor({
  pick,
  fixedList,
  catalog,
  onChange,
}: {
  pick: NonNullable<Character['feats'][string]['magicInitiate']> | undefined
  fixedList: string | null
  catalog: Catalog
  onChange: (value: NonNullable<Character['feats'][string]['magicInitiate']>) => void
}) {
  const state = pick ?? { list: fixedList, ability: null, cantrips: [], spell: null }
  const list = fixedList ?? state.list
  const spells = list ? classSpells(catalog, list) : []
  const cantrips = spells.filter((s) => s.level === 0)
  const firstLevel = spells.filter((s) => s.level === 1)
  return (
    <div className="choice-box">
      <div className="field-row">
        {fixedList ? (
          <p className="muted">
            Lista de magias: <strong>{fixedList}</strong> (definida pelo antecedente)
          </p>
        ) : (
          <SelectField label="Lista de magias" value={state.list} onChange={(v) => onChange({ ...state, list: v, cantrips: [], spell: null })} options={MAGIC_INITIATE_LISTS.map((l) => ({ value: l, label: l }))} />
        )}
        <SelectField label="Atributo de conjuração" value={state.ability} onChange={(v) => onChange({ ...state, ability: v as Ability | null })} options={abilityOptions(['INT', 'WIS', 'CHA'])} />
      </div>
      {list && (
        <>
          <h5>Truques (2)</h5>
          <CheckList columns limit={2} selected={state.cantrips} onChange={(next) => onChange({ ...state, cantrips: next })} items={cantrips.map((s) => ({ value: s.slug, label: s.name, hint: s.school }))} />
          <SelectField label="Magia de nível 1" value={state.spell} onChange={(v) => onChange({ ...state, spell: v })} options={firstLevel.map((s) => ({ value: s.slug, label: `${s.name} (${s.school})` }))} />
        </>
      )}
    </div>
  )
}
