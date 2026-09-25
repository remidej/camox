import { createLayout, notFound, type LayoutLoaderResult } from "camox/createLayout";

import { block as footerBlock } from "../blocks/footer";
import { block as navbarBlock } from "../blocks/navbar";
import {
  PokedexCredit,
  PokedexHeader,
  PokemonArtwork,
  TypeBadge,
  pokemonName,
  pokemonNumber,
  typeColor,
} from "../components/pokemon";

interface Pokemon {
  id: number;
  name: string;
  height: number;
  weight: number;
  base_experience: number | null;
  sprites: {
    front_default: string | null;
    other: { "official-artwork": { front_default: string | null } };
  };
  types: Array<{ type: { name: string } }>;
  abilities: Array<{ is_hidden: boolean; ability: { name: string } }>;
  stats: Array<{ base_stat: number; stat: { name: string } }>;
}

export const Layout = createLayout("pokemon.$name")({
  kind: "derived",
  title: "Pokémon",
  description: "Request-loaded Pokémon from PokéAPI",
  blocks: { before: [navbarBlock], after: [footerBlock] },
  buildMetaTitle: ({ pageMetaTitle }) => pageMetaTitle,
  loader: async ({ params }): Promise<LayoutLoaderResult<Pokemon>> => {
    const response = await fetch(
      `https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(params.name)}`,
    );
    if (response.status === 404) throw notFound();
    if (!response.ok) throw new Error(`PokéAPI returned ${response.status}`);
    return { kind: "data", data: await response.json() };
  },
  component: PokemonPage,
});

const statNames: Record<string, string> = {
  hp: "HP",
  attack: "Attack",
  defense: "Defense",
  "special-attack": "Sp. attack",
  "special-defense": "Sp. defense",
  speed: "Speed",
};
const discoveries = [
  { name: "bulbasaur", id: 1, type: "grass" },
  { name: "charmander", id: 4, type: "fire" },
  { name: "squirtle", id: 7, type: "water" },
  { name: "pikachu", id: 25, type: "electric" },
];

function PokemonPage() {
  const pokemon = Layout.useData();
  const primaryType = pokemon.types[0]?.type.name ?? "normal";
  const color = typeColor(primaryType);
  const totalStats = pokemon.stats.reduce((sum, stat) => sum + stat.base_stat, 0);

  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      <Layout.BeforeBlocks />
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 sm:px-8 sm:py-12">
        <PokedexHeader>
          <a
            href={`/pokemon-types/${primaryType}`}
            className="text-muted-foreground hover:text-foreground text-sm transition-colors"
          >
            Explore {primaryType} Pokémon ↗
          </a>
        </PokedexHeader>

        <section
          className="grid items-center gap-8 lg:grid-cols-2 lg:gap-16"
          aria-labelledby="pokemon-title"
        >
          <div
            className="border-border relative isolate flex aspect-square items-center justify-center overflow-hidden rounded-[2rem] border"
            style={{
              background: `radial-gradient(ellipse at 50% 40%, ${color}30, ${color}08 70%)`,
            }}
          >
            <span className="text-muted-foreground absolute top-6 left-6 font-mono text-sm">
              {pokemonNumber(pokemon.id)}
            </span>
            <span
              aria-hidden="true"
              className="border-foreground/5 absolute size-3/4 rounded-full border-[24px]"
            />
            <PokemonArtwork
              src={pokemon.sprites.other["official-artwork"].front_default}
              fallback={pokemon.sprites.front_default}
              name={pokemon.name}
              eager
              className="relative z-10 size-4/5 drop-shadow-2xl"
            />
            <span className="text-muted-foreground absolute bottom-6 text-xs font-medium tracking-[0.2em] uppercase">
              Pokédex entry
            </span>
          </div>

          <div className="min-w-0">
            <p className="text-muted-foreground mb-3 text-xs font-bold tracking-[0.2em] uppercase">
              Meet your next favorite
            </p>
            <h1
              id="pokemon-title"
              className="text-4xl font-bold tracking-tight break-words sm:text-6xl"
            >
              {pokemonName(pokemon.name)}
            </h1>
            <div className="mt-5 flex flex-wrap gap-2">
              {pokemon.types.map(({ type }) => (
                <TypeBadge key={type.name} name={type.name} />
              ))}
            </div>
            <p className="text-muted-foreground mt-6 max-w-md text-base leading-relaxed">
              Get to know {pokemonName(pokemon.name)}: its size, abilities, and the stats that make
              it one of a kind.
            </p>

            <dl className="border-border my-8 grid grid-cols-3 border-y py-6">
              {[
                { label: "Height", value: `${pokemon.height / 10} m` },
                { label: "Weight", value: `${pokemon.weight / 10} kg` },
                { label: "Base experience", value: pokemon.base_experience ?? "—" },
              ].map(({ label, value }) => (
                <div key={label}>
                  <dt className="text-muted-foreground text-xs sm:text-sm">{label}</dt>
                  <dd className="mt-2 text-xl font-semibold tabular-nums sm:text-2xl">{value}</dd>
                </div>
              ))}
            </dl>
            <h2 className="text-muted-foreground mb-3 text-xs font-bold tracking-[0.16em] uppercase">
              Abilities
            </h2>
            <ul className="flex flex-wrap gap-2">
              {pokemon.abilities.map(({ ability, is_hidden }) => (
                <li
                  key={ability.name}
                  className="bg-muted flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium"
                >
                  {pokemonName(ability.name)}
                  {is_hidden && (
                    <span className="text-muted-foreground text-xs font-normal">Hidden</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section
          className="border-border bg-card mt-10 rounded-3xl border p-6 sm:mt-14 sm:p-8"
          aria-labelledby="stats-title"
        >
          <div className="mb-7 flex items-center justify-between gap-4">
            <div>
              <p className="text-muted-foreground mb-1 text-xs font-bold tracking-[0.16em] uppercase">
                By the numbers
              </p>
              <h2 id="stats-title" className="text-2xl font-bold tracking-tight">
                Base stats
              </h2>
            </div>
            <p className="text-muted-foreground text-sm">
              Total{" "}
              <strong className="text-foreground ml-2 text-2xl font-semibold tabular-nums">
                {totalStats}
              </strong>
            </p>
          </div>
          <dl className="grid gap-x-12 gap-y-5 sm:grid-cols-2">
            {pokemon.stats.map(({ stat, base_stat }) => (
              <div key={stat.name}>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <dt className="text-muted-foreground">
                    {statNames[stat.name] ?? pokemonName(stat.name)}
                  </dt>
                  <dd className="font-semibold tabular-nums">{base_stat}</dd>
                </div>
                <div aria-hidden="true" className="bg-muted h-2 overflow-hidden rounded-full">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min((base_stat / 255) * 100, 100)}%`,
                      backgroundColor: color,
                    }}
                  />
                </div>
              </div>
            ))}
          </dl>
          <p className="text-muted-foreground mt-6 text-xs">
            Species base values, before level, training, or nature modifiers. Bars use a 255-point
            scale.
          </p>
        </section>

        <section className="mt-12" aria-labelledby="discover-title">
          <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="discover-title" className="text-xl font-bold tracking-tight">
              Keep exploring
            </h2>
            <span className="text-muted-foreground text-sm">A few familiar faces</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {discoveries
              .filter((item) => item.name !== pokemon.name)
              .slice(0, 3)
              .map((item) => (
                <a
                  key={item.name}
                  href={`/pokemon/${item.name}`}
                  className="group border-border bg-card hover:bg-muted focus-visible:ring-ring flex items-center gap-4 rounded-2xl border p-4 transition-colors focus-visible:ring-2 focus-visible:outline-none"
                >
                  <img
                    src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${item.id}.png`}
                    alt=""
                    width={64}
                    height={64}
                    loading="lazy"
                    className="size-16 rounded-xl"
                    style={{ backgroundColor: `${typeColor(item.type)}15` }}
                  />
                  <div>
                    <p className="text-muted-foreground font-mono text-xs">
                      {pokemonNumber(item.id)}
                    </p>
                    <p className="mt-1 font-semibold">{pokemonName(item.name)}</p>
                  </div>
                  <span
                    aria-hidden="true"
                    className="text-muted-foreground ml-auto transition-transform motion-safe:group-hover:translate-x-1"
                  >
                    ↗
                  </span>
                </a>
              ))}
          </div>
        </section>
        <PokedexCredit />
      </main>
      <Layout.AfterBlocks />
    </div>
  );
}
