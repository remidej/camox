import { Type, createBlock } from "camox/createBlock";

import { pokemonName, typeColor } from "../components/pokemon";

const pokemonTypes = [
  "normal",
  "fire",
  "water",
  "electric",
  "grass",
  "ice",
  "fighting",
  "poison",
  "ground",
  "flying",
  "psychic",
  "bug",
  "rock",
  "ghost",
  "dragon",
  "dark",
  "steel",
  "fairy",
];

const pokedex = createBlock({
  id: "pokedex-intro",
  title: "Pokédex introduction",
  layoutOnly: true,
  description:
    "The singleton Pokédex page introduction and type directory. The heading and introduction are editable; the type links follow the derived Pokémon routes.",
  content: {
    title: Type.String({ title: "Title", default: "Explore the Pokédex" }),
    description: Type.String({
      title: "Description",
      default:
        "Every type tells a different story. Pick a collection, discover its Pokémon, and find your next favorite.",
    }),
  },
  component: PokedexComponent,
  toMarkdown: (c) => [
    `## ${c.title}`,
    c.description,
    pokemonTypes
      .map((type) => `- [${pokemonName(type)} Pokémon](/pokemon-types/${type})`)
      .join("\n"),
  ],
});

function PokedexComponent() {
  return (
    <section
      className="bg-background text-foreground border-border border-y py-16 sm:py-24"
      aria-label="Pokédex"
    >
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="mb-10 max-w-2xl">
          <p className="text-muted-foreground mb-4 flex items-center gap-2 text-xs font-bold tracking-[0.2em] uppercase">
            <span aria-hidden="true" className="size-2 rounded-full bg-red-500" />
            The type collection
          </p>
          <pokedex.Field name="title">
            {(props) => <h1 {...props} className="text-3xl font-bold tracking-tight sm:text-5xl" />}
          </pokedex.Field>
          <pokedex.Field name="description">
            {(props) => (
              <p
                {...props}
                className="text-muted-foreground mt-5 text-base leading-relaxed sm:text-lg"
              />
            )}
          </pokedex.Field>
        </div>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {pokemonTypes.map((type) => {
            const color = typeColor(type);
            return (
              <li key={type}>
                <a
                  href={`/pokemon-types/${type}`}
                  className="group border-border focus-visible:ring-ring flex h-full flex-col gap-6 rounded-2xl border p-5 transition-transform hover:-translate-y-1 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                  style={{ background: `linear-gradient(140deg, ${color}18, ${color}04)` }}
                  aria-label={`Explore ${pokemonName(type)} Pokémon`}
                >
                  <span
                    aria-hidden="true"
                    className="size-7 rounded-full border-4"
                    style={{
                      backgroundColor: color,
                      borderColor: `${color}30`,
                      backgroundClip: "padding-box",
                    }}
                  />
                  <span className="flex items-center justify-between gap-2 text-sm font-semibold">
                    {pokemonName(type)}
                    <span
                      aria-hidden="true"
                      className="text-muted-foreground transition-transform group-hover:translate-x-1"
                    >
                      ↗
                    </span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

export { pokedex as block };
