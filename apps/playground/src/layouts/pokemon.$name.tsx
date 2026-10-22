import { createLayout, notFound, type LayoutLoaderResult } from "camox/createLayout";
import { useLocalizedHref } from "camox/navigation";

import { block as footerBlock } from "../blocks/footer";
import { block as navbarBlock } from "../blocks/navbar";
import { block as pokedexCreditBlock } from "../blocks/pokedex-credit";
import { block as pokedexHeaderBlock } from "../blocks/pokedex-header";
import {
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
  blocks: {
    before: [navbarBlock, pokedexHeaderBlock],
    after: [pokedexCreditBlock, footerBlock],
  },
  loader: async ({ params }): Promise<LayoutLoaderResult<Pokemon>> => {
    const response = await fetch(
      `https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(params.name)}`,
    );
    if (response.status === 404) throw notFound();
    if (!response.ok) throw new Error(`PokéAPI returned ${response.status}`);
    return { kind: "data", data: await response.json() };
  },
  routes: async () => {
    const response = await fetch("https://pokeapi.co/api/v2/pokemon?limit=2000");
    if (!response.ok) throw new Error(`PokéAPI returned ${response.status}`);
    const list: { results: Array<{ name: string }> } = await response.json();
    return { data: list.results.map(({ name }) => ({ params: { name } })) };
  },
  // Metadata and Markdown follow the loader: their `data` is inferred from it.
  toTitle: ({ data }) => `${pokemonName(data.name)} ${pokemonNumber(data.id)} – Pokédex`,
  toDescription: ({ data }) =>
    `${pokemonName(data.name)}, a Pokémon of type ${data.types.map(({ type }) => type.name).join(" and ")}.`,
  toMarkdown: ({ data }) => [
    `# ${pokemonName(data.name)} ${pokemonNumber(data.id)}`,
    `Types: ${data.types.map(({ type }) => type.name).join(", ")}`,
    `Height: ${data.height / 10} m. Weight: ${data.weight / 10} kg.`,
    `Abilities: ${data.abilities.map(({ ability }) => pokemonName(ability.name)).join(", ")}`,
    data.stats
      .map(({ base_stat, stat }) => `- ${statNames[stat.name] ?? stat.name}: ${base_stat}`)
      .join("\n"),
  ],
  toReact: PokemonPage,
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
  const localized = useLocalizedHref();
  const pokemon = Layout.useData();
  const primaryType = pokemon.types[0]?.type.name ?? "normal";
  const color = typeColor(primaryType);
  const totalStats = pokemon.stats.reduce((sum, stat) => sum + stat.base_stat, 0);

  return (
    <div className="bg-canvas text-ink flex min-h-screen flex-col">
      <Layout.BeforeBlocks />
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 sm:px-8">
        <section
          className="grid items-center gap-8 lg:grid-cols-2 lg:gap-16"
          aria-labelledby="pokemon-title"
        >
          <div
            className="border-line relative isolate flex aspect-square items-center justify-center overflow-hidden rounded-[2rem] border"
            style={{
              background: `radial-gradient(ellipse at 50% 40%, ${color}30, ${color}08 70%)`,
            }}
          >
            <span className="text-ink-muted absolute top-6 left-6 font-mono text-sm">
              {pokemonNumber(pokemon.id)}
            </span>
            <span
              aria-hidden="true"
              className="border-ink/5 absolute size-3/4 rounded-full border-[24px]"
            />
            <PokemonArtwork
              src={pokemon.sprites.other["official-artwork"].front_default}
              fallback={pokemon.sprites.front_default}
              name={pokemon.name}
              eager
              className="relative z-10 size-4/5 drop-shadow-2xl"
            />
            <span className="text-ink-muted absolute bottom-6 text-xs font-medium tracking-[0.2em] uppercase">
              Pokédex entry
            </span>
          </div>

          <div className="min-w-0">
            <p className="text-ink-muted mb-3 text-xs font-bold tracking-[0.2em] uppercase">
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
            <p className="text-ink-muted mt-6 max-w-md text-base leading-relaxed">
              Get to know {pokemonName(pokemon.name)}: its size, abilities, and the stats that make
              it one of a kind.
            </p>

            <dl className="border-line my-8 grid grid-cols-3 border-y py-6">
              {[
                { label: "Height", value: `${pokemon.height / 10} m` },
                { label: "Weight", value: `${pokemon.weight / 10} kg` },
                { label: "Base experience", value: pokemon.base_experience ?? "—" },
              ].map(({ label, value }) => (
                <div key={label}>
                  <dt className="text-ink-muted text-xs sm:text-sm">{label}</dt>
                  <dd className="mt-2 text-xl font-semibold tabular-nums sm:text-2xl">{value}</dd>
                </div>
              ))}
            </dl>
            <h2 className="text-ink-muted mb-3 text-xs font-bold tracking-[0.16em] uppercase">
              Abilities
            </h2>
            <ul className="flex flex-wrap gap-2">
              {pokemon.abilities.map(({ ability, is_hidden }) => (
                <li
                  key={ability.name}
                  className="bg-ink/5 flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium"
                >
                  {pokemonName(ability.name)}
                  {is_hidden && <span className="text-ink-muted text-xs font-normal">Hidden</span>}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section
          className="border-line bg-panel mt-10 rounded-3xl border p-6 sm:mt-14 sm:p-8"
          aria-labelledby="stats-title"
        >
          <div className="mb-7 flex items-center justify-between gap-4">
            <div>
              <p className="text-ink-muted mb-1 text-xs font-bold tracking-[0.16em] uppercase">
                By the numbers
              </p>
              <h2 id="stats-title" className="text-2xl font-bold tracking-tight">
                Base stats
              </h2>
            </div>
            <p className="text-ink-muted text-sm">
              Total{" "}
              <strong className="text-ink ml-2 text-2xl font-semibold tabular-nums">
                {totalStats}
              </strong>
            </p>
          </div>
          <dl className="grid gap-x-12 gap-y-5 sm:grid-cols-2">
            {pokemon.stats.map(({ stat, base_stat }) => (
              <div key={stat.name}>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <dt className="text-ink-muted">
                    {statNames[stat.name] ?? pokemonName(stat.name)}
                  </dt>
                  <dd className="font-semibold tabular-nums">{base_stat}</dd>
                </div>
                <div aria-hidden="true" className="bg-ink/5 h-2 overflow-hidden rounded-full">
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
          <p className="text-ink-muted mt-6 text-xs">
            Species base values, before level, training, or nature modifiers. Bars use a 255-point
            scale.
          </p>
        </section>

        <section className="mt-12" aria-labelledby="discover-title">
          <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="discover-title" className="text-xl font-bold tracking-tight">
              Keep exploring
            </h2>
            <span className="text-ink-muted text-sm">A few familiar faces</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {discoveries
              .filter((item) => item.name !== pokemon.name)
              .slice(0, 3)
              .map((item) => (
                <a
                  key={item.name}
                  href={localized(`/pokemon/${item.name}`)}
                  className="group border-line bg-panel hover:bg-ink/5 focus-visible:ring-brand flex items-center gap-4 rounded-2xl border p-4 transition-colors focus-visible:ring-2 focus-visible:outline-none"
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
                    <p className="text-ink-muted font-mono text-xs">{pokemonNumber(item.id)}</p>
                    <p className="mt-1 font-semibold">{pokemonName(item.name)}</p>
                  </div>
                  <span
                    aria-hidden="true"
                    className="text-ink-muted ml-auto transition-transform motion-safe:group-hover:translate-x-1"
                  >
                    ↗
                  </span>
                </a>
              ))}
          </div>
        </section>
      </main>
      <Layout.AfterBlocks />
    </div>
  );
}
