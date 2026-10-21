import { useState } from 'react'
import type { Catalog, EquipmentOption, ItemType } from '../../api/types'
import { addItem, applyEquipmentOption, removeItem, resolveChoice, setEquipped, setQuantity } from '../../domain/equipment'
import { lookup } from '../../domain/lookup'
import { Notice, OptionCard, Section } from '../ui'
import type { StepProps } from './types'

const TYPE_LABEL: Record<ItemType, string> = { weapon: 'Arma', armor: 'Armadura', tool: 'Ferramenta', gear: 'Equipamento' }

function OptionList({ title, options, selected, onSelect }: { title: string; options: EquipmentOption[]; selected: string | null; onSelect: (label: string) => void }) {
  return (
    <Section title={title}>
      <div className="card-grid">
        {options.map((o) => (
          <OptionCard
            key={o.option_label}
            selected={selected === o.option_label}
            onClick={() => onSelect(o.option_label)}
            title={`Opção ${o.option_label}`}
            subtitle={o.gold_gp > 0 ? `${o.gold_gp} GP${o.items.length ? ' + itens' : ''}` : undefined}
          >
            <span className="option-text">{o.items.length > 0 ? o.items.map((i) => `${i.quantity > 1 ? `${i.quantity}× ` : ''}${i.item_name}`).join(', ') : 'Apenas ouro'}</span>
          </OptionCard>
        ))}
      </div>
    </Section>
  )
}

function catalogFor(catalog: Catalog, type: ItemType) {
  return { weapon: catalog.weapons, armor: catalog.armor, tool: catalog.tools, gear: catalog.gear }[type]
}

export function EquipmentStep({ character, derived, catalog, change }: StepProps) {
  const { plan } = derived
  const look = lookup(catalog)
  const [type, setType] = useState<ItemType>('gear')
  const [query, setQuery] = useState('')
  const matches = query.trim().length >= 2 ? catalogFor(catalog, type).filter((i) => i.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 12) : []

  return (
    <div className="step">
      <h2>Equipamento</h2>
      <p className="lead">Escolha o equipamento inicial da classe e do antecedente (ou o ouro no lugar dele). Depois você pode ajustar o inventário livremente.</p>

      {plan.cls ? (
        <OptionList title={`Equipamento inicial de ${plan.cls.name}`} options={plan.cls.starting_equipment_options} selected={character.classEquipment} onSelect={(label) => change((c) => applyEquipmentOption(c, catalog, 'class', label))} />
      ) : (
        <Notice>Escolha uma classe para ver o equipamento inicial.</Notice>
      )}
      {plan.background ? (
        <OptionList title={`Equipamento do antecedente ${plan.background.name}`} options={plan.background.equipment_options} selected={character.backgroundEquipment} onSelect={(label) => change((c) => applyEquipmentOption(c, catalog, 'background', label))} />
      ) : (
        <Notice>Escolha um antecedente para ver o equipamento dele.</Notice>
      )}

      {character.inventory.some((i) => i.choices.length > 0) && (
        <Section title="Itens a definir" hint="Algumas opções deixam você escolher qual item recebe.">
          {character.inventory
            .filter((i) => i.choices.length > 0)
            .map((item) => (
              <label key={item.id} className="field">
                <span className="field-label">{item.name}</span>
                <select value="" onChange={(e) => e.target.value && change((c) => resolveChoice(c, item.id, e.target.value, catalog))}>
                  <option value="">Escolha…</option>
                  {item.choices.map((slug) => (
                    <option key={slug} value={slug}>
                      {(item.type && catalogFor(catalog, item.type).find((i) => i.slug === slug)?.name) ?? slug}
                    </option>
                  ))}
                </select>
              </label>
            ))}
        </Section>
      )}

      <Section title="Inventário">
        {character.inventory.length === 0 ? (
          <p className="muted">Nenhum item ainda.</p>
        ) : (
          <div className="table-scroll">
          <table className="inventory">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qtd.</th>
                <th>Equipado</th>
                <th>
                  <span className="sr-only">Remover</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {character.inventory.map((item) => {
                const canEquip = (item.type === 'weapon' || item.type === 'armor') && item.slug
                const armor = item.type === 'armor' && item.slug ? look.armor.get(item.slug) : undefined
                return (
                  <tr key={item.id}>
                    <th scope="row">
                      {item.name}
                      <span className="muted"> {item.type ? TYPE_LABEL[item.type] : 'Item'}{armor ? ` · CA ${armor.ac_formula_display}` : ''}</span>
                    </th>
                    <td>
                      <span className="stepper">
                        <button type="button" aria-label={`Diminuir ${item.name}`} onClick={() => change((c) => setQuantity(c, item.id, item.quantity - 1))}>
                          −
                        </button>
                        <output>{item.quantity}</output>
                        <button type="button" aria-label={`Aumentar ${item.name}`} onClick={() => change((c) => setQuantity(c, item.id, item.quantity + 1))}>
                          +
                        </button>
                      </span>
                    </td>
                    <td>
                      {canEquip ? (
                        <label className="toggle">
                          <input type="checkbox" checked={item.equipped} onChange={(e) => change((c) => setEquipped(c, catalog, item.id, e.target.checked))} />
                          <span>{item.equipped ? 'Sim' : 'Não'}</span>
                        </label>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => change((c) => removeItem(c, item.id))}>
                        Remover
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        )}
        <p className="muted">
          Peso carregado: {derived.weightCarried} lb · Capacidade: {derived.carryCapacity} lb
        </p>
        {derived.warnings.map((w) => (
          <Notice key={w} tone="warn">
            {w}
          </Notice>
        ))}
      </Section>

      <Section title="Adicionar item" hint="Procure em todo o catálogo do SRD.">
        <div className="picker-tools">
          <select aria-label="Tipo de item" value={type} onChange={(e) => setType(e.target.value as ItemType)}>
            {(Object.keys(TYPE_LABEL) as ItemType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          <input type="search" placeholder="Digite ao menos 2 letras…" aria-label="Buscar item" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {matches.length > 0 && (
          <ul className="result-list">
            {matches.map((i) => (
              <li key={i.slug}>
                <span>
                  {i.name} <span className="muted">{i.cost_display}</span>
                </span>
                <button type="button" className="btn btn-sm" onClick={() => change((c) => addItem(c, catalog, type, i.slug))}>
                  Adicionar
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Ouro">
        <label className="field field-inline">
          <span className="field-label">Ouro extra (GP)</span>
          <input type="number" min={0} value={character.extraGold} onChange={(e) => change((c) => ({ ...c, extraGold: Math.max(0, Number(e.target.value) || 0) }))} />
        </label>
        <p className="muted">
          Total: <strong>{derived.gold} GP</strong> (opções iniciais + ouro extra)
        </p>
      </Section>
    </div>
  )
}
