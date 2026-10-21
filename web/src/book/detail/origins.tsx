import type { BackgroundData, Catalog, FeatData, SpeciesData } from '../../api/types'
import { Chip, Markdown } from '../../components/ui'
import { ABILITY_LABEL } from '../../domain/srd'
import { bookHref } from '../sections'

export function SpeciesDetail({ species }: { species: SpeciesData }) {
  return (
    <article className="entry">
      <h2>{species.name}</h2>
      <p className="chips">
        <Chip>{species.sizes.join(' ou ')}</Chip>
        <Chip>Velocidade {species.speed_ft} ft</Chip>
        {species.darkvision_ft ? <Chip>Visão no escuro {species.darkvision_ft} ft</Chip> : null}
      </p>
      {species.description && <Markdown>{species.description}</Markdown>}
      {species.traits.map((t) => (
        <section key={t.slug} className="feature">
          <h4>{t.name}</h4>
          <Markdown>{t.description}</Markdown>
        </section>
      ))}
    </article>
  )
}

export function BackgroundDetail({ background, catalog }: { background: BackgroundData; catalog: Catalog }) {
  const tool = background.tool_slug ? catalog.tools.find((t) => t.slug === background.tool_slug) : undefined
  return (
    <article className="entry">
      <h2>{background.name}</h2>
      <dl className="facts">
        <dt>Atributos</dt>
        <dd>{background.ability_scores.map((a) => ABILITY_LABEL[a]).join(', ')}</dd>
        <dt>Talento</dt>
        <dd>
          <a href={bookHref('talentos', background.origin_feat_slug)}>{background.origin_feat_name}</a>
        </dd>
        <dt>Perícias</dt>
        <dd>{background.skill_proficiencies.join(' e ')}</dd>
        <dt>Ferramenta</dt>
        <dd>{tool ? <a href={bookHref('ferramentas', tool.slug)}>{tool.name}</a> : background.tool_proficiency}</dd>
        <dt>Equipamento</dt>
        <dd>
          {background.equipment_options.map((o) => (
            <div key={o.option_label}>
              <strong>({o.option_label})</strong> {o.items.map((i) => `${i.quantity > 1 ? `${i.quantity}× ` : ''}${i.item_name}`).join(', ')}
              {o.gold_gp ? `${o.items.length ? ', ' : ''}${o.gold_gp} GP` : ''}
            </div>
          ))}
        </dd>
      </dl>
      {background.description && <Markdown>{background.description}</Markdown>}
    </article>
  )
}

export function FeatDetail({ feat }: { feat: FeatData }) {
  return (
    <article className="entry">
      <h2>{feat.name}</h2>
      <p className="chips">
        <Chip tone="accent">{feat.category}</Chip>
        {feat.prerequisite_text && <Chip>Pré-requisito: {feat.prerequisite_text}</Chip>}
        {feat.repeatable && <Chip>Repetível</Chip>}
      </p>
      {feat.description && <Markdown>{feat.description}</Markdown>}
      {feat.benefits.map((b) => (
        <section key={b.name} className="feature">
          <Markdown>{`**${b.name}.** ${b.description}`}</Markdown>
        </section>
      ))}
    </article>
  )
}
