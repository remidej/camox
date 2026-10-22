import { createBlock } from "camox/createBlock";
import { useLocalizedHref } from "camox/navigation";

const pokedexHeader = createBlock({
  id: "pokedex-header",
  title: "Pokédex header",
  layoutOnly: true,
  synced: true,
  description:
    "The field guide's masthead above the Pokémon and type pages, with a link to meet a Pokémon.",
  content: (field) => ({
    title: field.string({ title: "Title", default: "The Pokédex" }),
    tagline: field.string({ title: "Tagline", default: "/ Field guide" }),
    cta: field.string({ title: "Call to action", default: "Meet a Pokémon ↗" }),
  }),
  toReact: PokedexHeaderComponent,
  toTitle: ({ content }) => content.title,
  toMarkdown: ({ content }) => [
    `${content.title} ${content.tagline}`,
    `[${content.cta}](/pokemon/pikachu)`,
  ],
});

function PokedexHeaderComponent() {
  const localized = useLocalizedHref();
  return (
    <div className="mx-auto w-full max-w-6xl px-5 pt-8 sm:px-8 sm:pt-12">
      <div className="border-line mb-8 flex flex-wrap items-center justify-between gap-4 border-b pb-5 sm:mb-12">
        <a
          href={localized("/pokemon/pikachu")}
          className="focus-visible:ring-brand inline-flex items-center gap-3 rounded-lg focus-visible:ring-2 focus-visible:outline-none"
        >
          <span
            aria-hidden="true"
            className="border-ink relative size-7 overflow-hidden rounded-full border-2"
          >
            <span className="bg-ink absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2" />
            <span className="border-ink bg-canvas absolute top-1/2 left-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2" />
          </span>
          <span className="text-sm font-bold tracking-tight">
            <pokedexHeader.Field name="title">{(props) => <span {...props} />}</pokedexHeader.Field>{" "}
            <pokedexHeader.Field name="tagline">
              {(props) => <span {...props} className="text-ink-muted ml-1 font-normal" />}
            </pokedexHeader.Field>
          </span>
        </a>
        <pokedexHeader.Field name="cta">
          {(props) => (
            <a
              {...props}
              href={localized("/pokemon/pikachu")}
              className="text-ink-muted hover:text-ink text-sm transition-colors"
            />
          )}
        </pokedexHeader.Field>
      </div>
    </div>
  );
}

export { pokedexHeader as block };
