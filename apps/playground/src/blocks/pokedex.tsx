import { useQuery } from "@tanstack/react-query";
import { Type, createBlock } from "camox/createBlock";

import { PokemonArtwork, pokemonName, pokemonNumber } from "../components/pokemon";

const pokedex = createBlock({
  id: "pokedex",
  title: "Pokémon of the week",
  description:
    "Spotlight three editor-picked Pokémon with names and artwork loaded from PokéAPI and links to their field-guide pages. Set each repeater item's Pokémon name in the editor sidebar (for example, gengar or mr-mime); names are not inline-editable on the cards.",
  content: {
    title: Type.String({ title: "Title", default: "Pokémon of the week" }),
    description: Type.String({
      title: "Description",
      default:
        "Three favorites, picked just for you. Meet this week’s stars and discover their stories.",
    }),
    pokemon: Type.Repeater({
      title: "Pokémon",
      content: {
        name: Type.String({
          title: "Pokémon name",
          default: "pikachu",
          minLength: 1,
          maxLength: 100,
        }),
      },
      minItems: 3,
      maxItems: 3,
      toMarkdown: (c) => [`- ${c.name}`],
    }),
  },
  component: PokedexComponent,
  toMarkdown: (c) => [
    `## ${c.title}`,
    c.description,
    c.pokemon,
    "[Explore the full Pokédex](/pokedex)",
  ],
});

function PokedexComponent() {
  return (
    <section
      className="bg-background text-foreground border-border border-y py-16 sm:py-24"
      aria-label="Pokémon of the week"
    >
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="mb-10 max-w-2xl">
          <p className="text-muted-foreground mb-4 flex items-center gap-2 text-xs font-bold tracking-[0.2em] uppercase">
            <span aria-hidden="true" className="size-2 rounded-full bg-red-500" />
            The weekly selection
          </p>
          <pokedex.Field name="title">
            {(props) => <h2 {...props} className="text-3xl font-bold tracking-tight sm:text-5xl" />}
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
        <ul className="grid gap-5 sm:grid-cols-3">
          <pokedex.Repeater name="pokemon">
            {(item) => (
              <item.Field name="name">
                {(_props, { text }) => (
                  <li className="border-border bg-card flex h-full flex-col rounded-2xl border p-6">
                    <PokemonSpotlight name={text} />
                  </li>
                )}
              </item.Field>
            )}
          </pokedex.Repeater>
        </ul>
        <a
          href="/pokedex"
          className="focus-visible:ring-ring mt-8 inline-flex rounded-sm font-semibold underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
        >
          Explore the full Pokédex →
        </a>
      </div>
    </section>
  );
}

interface Pokemon {
  id: number;
  name: string;
  sprites: {
    front_default: string | null;
    other: { "official-artwork": { front_default: string | null } };
  };
}

function PokemonSpotlight({ name }: { name: string }) {
  const slug = name.trim().toLowerCase().replace(/\s+/g, "-");
  const validName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["weekly-pokemon", slug],
    enabled: validName,
    staleTime: 60 * 60 * 1000,
    retry: false,
    queryFn: async ({ signal }): Promise<Pokemon> => {
      const response = await fetch(`https://pokeapi.co/api/v2/pokemon/${slug}`, { signal });
      if (response.status === 404)
        throw new Error("Pokémon not found. Check the name in the editor sidebar.");
      if (!response.ok) throw new Error("Could not load this Pokémon. Please try again.");
      return response.json();
    },
  });

  if (!validName) {
    return <p className="text-muted-foreground">Set a Pokémon name in the editor sidebar.</p>;
  }
  if (error) {
    return (
      <div role="status" className="text-muted-foreground">
        <p>{error.message}</p>
        <button type="button" onClick={() => void refetch()} className="mt-3 underline">
          Try again
        </button>
      </div>
    );
  }
  if (isPending) {
    return (
      <p
        role="status"
        className="text-muted-foreground flex aspect-square items-center justify-center"
      >
        Loading Pokémon…
      </p>
    );
  }

  return (
    <a
      href={`/pokemon/${data.name}`}
      className="focus-visible:ring-ring flex flex-1 flex-col rounded-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      aria-label={`Explore ${pokemonName(data.name)}`}
    >
      <h3 className="mb-4 text-xl font-semibold">{pokemonName(data.name)}</h3>
      <span className="text-muted-foreground font-mono text-xs">{pokemonNumber(data.id)}</span>
      <PokemonArtwork
        key={data.name}
        name={data.name}
        src={data.sprites.other["official-artwork"].front_default}
        fallback={data.sprites.front_default}
        className="mx-auto aspect-square w-full max-w-72"
      />
      <span className="mt-4 font-semibold">View field guide →</span>
    </a>
  );
}

export { pokedex as block };
