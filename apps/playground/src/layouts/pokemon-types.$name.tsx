import { createLayout, notFound, type LayoutLoaderResult } from "camox/createLayout";
import { useLocalizedHref } from "camox/navigation";
import { useState } from "react";

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

interface NamedResource {
  name: string;
  url: string;
}
interface PokemonType {
  name: string;
  pokemon: Array<{ pokemon: NamedResource }>;
  damage_relations: {
    double_damage_to: NamedResource[];
    double_damage_from: NamedResource[];
    no_damage_from: NamedResource[];
  };
}

export const Layout = createLayout("pokemon-types.$name")({
  kind: "derived",
  title: "Pokémon types",
  description: "PokéAPI type detail pages",
  blocks: {
    before: [navbarBlock, pokedexHeaderBlock],
    after: [pokedexCreditBlock, footerBlock],
  },
  loader: async ({ params }): Promise<LayoutLoaderResult<PokemonType>> => {
    const response = await fetch(
      `https://pokeapi.co/api/v2/type/${encodeURIComponent(params.name)}`,
    );
    if (response.status === 404) throw notFound();
    if (!response.ok) throw new Error(`PokéAPI returned ${response.status}`);
    return { kind: "data", data: await response.json() };
  },
  routes: async () => {
    const response = await fetch("https://pokeapi.co/api/v2/type?limit=100");
    if (!response.ok) throw new Error(`PokéAPI returned ${response.status}`);
    const list: { results: Array<{ name: string }> } = await response.json();
    return { data: list.results.map(({ name }) => ({ params: { name } })) };
  },
  toTitle: ({ data }) => `${pokemonName(data.name)} type – Pokédex`,
  toDescription: ({ data }) => `${data.pokemon.length} Pokémon have the ${data.name} type.`,
  toMarkdown: ({ data }) => {
    const names = (resources: NamedResource[]) =>
      resources.map(({ name }) => pokemonName(name)).join(", ") || "None";
    return [
      `# ${pokemonName(data.name)} type`,
      `Super effective against: ${names(data.damage_relations.double_damage_to)}`,
      `Weak to: ${names(data.damage_relations.double_damage_from)}`,
      `Immune to: ${names(data.damage_relations.no_damage_from)}`,
      `${data.pokemon.length} Pokémon: ${data.pokemon.map(({ pokemon }) => pokemonName(pokemon.name)).join(", ")}`,
    ];
  },
  toReact: TypePage,
});

const PAGE_SIZE = 36;
const featuredTypes = ["grass", "fire", "water", "electric", "psychic", "dragon"];

function TypePage() {
  const localized = useLocalizedHref();
  const type = Layout.useData();
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const color = typeColor(type.name);
  const pokemon = type.pokemon.map(({ pokemon }) => ({
    name: pokemon.name,
    id: Number(pokemon.url.match(/\/pokemon\/(\d+)\/?$/)?.[1]) || null,
  }));
  const query = search.trim().toLowerCase();
  const matches = pokemon.filter(
    (item) =>
      pokemonName(item.name).toLowerCase().includes(query.replaceAll("-", " ")) ||
      (query && item.id != null && item.id === Number(query.replace(/^#/, ""))),
  );
  const visible = matches.slice(0, visibleCount);

  return (
    <div className="bg-canvas text-ink flex min-h-screen flex-col">
      <Layout.BeforeBlocks />
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 sm:px-8">
        <section
          className="border-line relative overflow-hidden rounded-[2rem] border px-6 py-10 sm:p-12"
          style={{ background: `linear-gradient(120deg, ${color}20, ${color}04)` }}
          aria-labelledby="type-title"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-20 -right-20 size-80 rounded-full border-[50px]"
            style={{ borderColor: `${color}10` }}
          />
          <div className="relative">
            <p className="text-ink-muted mb-4 flex items-center gap-2 text-xs font-bold tracking-[0.2em] uppercase">
              <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
              The type collection
            </p>
            <h1 id="type-title" className="text-4xl font-bold tracking-tight sm:text-6xl">
              {pokemonName(type.name)} Pokémon<span style={{ color }}>.</span>
            </h1>
            <p className="text-ink-muted mt-5 max-w-xl text-base leading-relaxed">
              One type. A world of possibilities. Discover all {pokemon.length} Pokémon and forms in
              this collection, and find your next favorite.
            </p>
          </div>
        </section>

        <section className="my-8 grid gap-4 sm:grid-cols-3" aria-label="Type matchups">
          {[
            {
              label: "Super effective against",
              detail: "Deals 2× damage",
              types: type.damage_relations.double_damage_to,
            },
            {
              label: "Weak against",
              detail: "Takes 2× damage",
              types: type.damage_relations.double_damage_from,
            },
            {
              label: "Immune to",
              detail: "Takes no damage",
              types: type.damage_relations.no_damage_from,
            },
          ].map((group) => (
            <div key={group.label} className="border-line rounded-2xl border p-5">
              <h2 className="text-sm font-semibold">{group.label}</h2>
              <p className="text-ink-muted mt-1 text-xs">{group.detail}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {group.types.length ? (
                  group.types.map((item) => <TypeBadge key={item.name} name={item.name} />)
                ) : (
                  <span className="text-ink-muted py-1.5 text-sm">None</span>
                )}
              </div>
            </div>
          ))}
        </section>
        <p className="text-ink-muted -mt-4 mb-10 text-xs">
          Matchups apply to this type alone. A Pokémon’s second type may change the result.
        </p>

        <section aria-labelledby="collection-title">
          <div className="mb-6 flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
            <div>
              <h2 id="collection-title" className="text-2xl font-bold tracking-tight">
                The collection
              </h2>
              <p role="status" className="text-ink-muted mt-1 text-sm">
                {matches.length} {matches.length === 1 ? "Pokémon" : "Pokémon & forms"}
                {query ? " found" : " to discover"}
              </p>
            </div>
            <div className="w-full sm:w-72">
              <label htmlFor="pokemon-search" className="sr-only">
                Search Pokémon by name or number
              </label>
              <input
                id="pokemon-search"
                type="search"
                placeholder="Search by name or number…"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setVisibleCount(PAGE_SIZE);
                }}
                className="border-line bg-panel placeholder:text-ink-muted focus:border-brand focus:ring-brand w-full rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2"
              />
            </div>
          </div>

          {matches.length === 0 ? (
            <div className="border-line rounded-2xl border border-dashed px-6 py-16 text-center">
              <h3 className="text-lg font-semibold">
                {query ? "No Pokémon found" : "An undiscovered collection"}
              </h3>
              <p className="text-ink-muted mt-2 text-sm">
                {query
                  ? "Try a different name or Pokédex number."
                  : "PokéAPI hasn’t listed any Pokémon for this type yet. Explore another type below."}
              </p>
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setVisibleCount(PAGE_SIZE);
                  }}
                  className="mt-5 text-sm font-semibold underline underline-offset-4"
                >
                  Clear search
                </button>
              )}
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
              {visible.map((item) => (
                <li key={item.name}>
                  <a
                    href={localized(`/pokemon/${item.name}`)}
                    className="group border-line bg-panel hover:border-ink/30 focus-visible:ring-brand flex h-full flex-col overflow-hidden rounded-2xl border transition-colors focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <div
                      className="relative flex aspect-[4/3] items-center justify-center"
                      style={{
                        background: `radial-gradient(ellipse at center, ${color}18, transparent 75%)`,
                      }}
                    >
                      <span className="text-ink-muted absolute top-3 left-4 font-mono text-xs">
                        {item.id != null ? pokemonNumber(item.id) : "—"}
                      </span>
                      <PokemonArtwork
                        src={
                          item.id != null
                            ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${item.id}.png`
                            : null
                        }
                        fallback={
                          item.id != null
                            ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${item.id}.png`
                            : null
                        }
                        name={item.name}
                        className="size-3/4 transition-transform duration-200 motion-safe:group-hover:scale-105"
                      />
                    </div>
                    <div className="flex items-start justify-between gap-2 px-4 pb-4">
                      <span className="text-sm font-semibold sm:text-base">
                        {pokemonName(item.name)}
                      </span>
                      <span aria-hidden="true" className="text-ink-muted">
                        ↗
                      </span>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          )}

          {visibleCount < matches.length && (
            <div className="mt-8 text-center">
              <button
                type="button"
                onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
                className="border-line bg-panel hover:bg-ink/5 focus-visible:ring-brand rounded-full border px-7 py-3 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                Show {Math.min(PAGE_SIZE, matches.length - visibleCount)} more{" "}
                <span aria-hidden="true" className="ml-2">
                  ↓
                </span>
              </button>
              <p className="text-ink-muted mt-3 text-xs">
                Showing {visible.length} of {matches.length}
              </p>
            </div>
          )}
        </section>

        <nav
          aria-label="Explore other Pokémon types"
          className="border-line mt-12 rounded-2xl border p-6"
        >
          <h2 className="mb-4 text-sm font-semibold">A different kind of discovery</h2>
          <div className="flex flex-wrap gap-2">
            {featuredTypes
              .filter((name) => name !== type.name)
              .map((name) => (
                <TypeBadge key={name} name={name} />
              ))}
          </div>
        </nav>
      </main>
      <Layout.AfterBlocks />
    </div>
  );
}
