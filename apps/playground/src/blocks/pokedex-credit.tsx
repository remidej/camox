import { createBlock } from "camox/createBlock";

const pokedexCredit = createBlock({
  id: "pokedex-credit",
  title: "Pokédex credit",
  layoutOnly: true,
  synced: true,
  description:
    "The field guide's closing note below the Pokémon and type pages, crediting PokéAPI.",
  content: (field) => ({
    note: field.string({
      title: "Note",
      default: "A living field guide. Every page is loaded on request.",
    }),
    source: field.link({
      title: "Source",
      default: { text: "Data from PokéAPI ↗", href: "https://pokeapi.co/", newTab: true },
    }),
  }),
  toReact: PokedexCreditComponent,
  toMarkdown: ({ content }) => [content.note, content.source],
});

function PokedexCreditComponent() {
  return (
    <div className="mx-auto w-full max-w-6xl px-5 pb-8 sm:px-8 sm:pb-12">
      <div className="border-line text-ink-muted mt-12 flex flex-wrap items-center justify-between gap-3 border-t pt-5 text-xs">
        <pokedexCredit.Field name="note">{(props) => <p {...props} />}</pokedexCredit.Field>
        <pokedexCredit.Link name="source">
          {(props) => <a {...props} className="hover:text-ink underline underline-offset-4" />}
        </pokedexCredit.Link>
      </div>
    </div>
  );
}

export { pokedexCredit as block };
