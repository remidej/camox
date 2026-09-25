import { createLayout } from "camox/createLayout";
import { useState } from "react";

import { block as footerBlock } from "../blocks/footer";
import { block as navbarBlock } from "../blocks/navbar";
import { block as pokedexBlock } from "../blocks/pokedex-intro";
import { PokemonArtwork, pokemonName, pokemonNumber } from "../components/pokemon";

interface PokemonList {
  results: Array<{ name: string; url: string }>;
}

export const Layout = createLayout("pokedex")({
  kind: "singleton",
  title: "Pokédex",
  description: "The code-owned Pokémon directory, with an editable introduction.",
  blocks: { before: [navbarBlock, pokedexBlock], after: [footerBlock] },
  buildMetaTitle: ({ pageMetaTitle }) => pageMetaTitle,
  loader: async () => {
    const response = await fetch("https://pokeapi.co/api/v2/pokemon?limit=2000");
    if (!response.ok) throw new Error(`PokéAPI returned ${response.status}`);
    const data: PokemonList = await response.json();
    return {
      kind: "data",
      data: data.results.map((pokemon) => ({
        name: pokemon.name,
        id: Number(pokemon.url.match(/\/pokemon\/(\d+)\/?$/)?.[1]),
      })),
    };
  },
  component: PokedexPage,
});

function PokedexPage() {
  const pokemon = Layout.useData();
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(48);
  const query = search.trim().toLowerCase();
  const matches = pokemon.filter(
    (item) =>
      pokemonName(item.name).toLowerCase().includes(query.replaceAll("-", " ")) ||
      (query && item.id === Number(query.replace(/^#/, ""))),
  );

  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      <Layout.BeforeBlocks />
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-12 sm:px-8">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold">All Pokémon</h2>
            <p role="status" className="text-muted-foreground">
              {matches.length} Pokémon found
            </p>
          </div>
          <div>
            <label htmlFor="pokedex-search" className="sr-only">
              Search Pokémon by name or number
            </label>
            <input
              id="pokedex-search"
              type="search"
              placeholder="Search by name or number…"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setLimit(48);
              }}
              className="border-border bg-card w-72 rounded-xl border px-4 py-3"
            />
          </div>
        </div>
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {matches.slice(0, limit).map((item) => (
            <li key={item.name}>
              <a
                href={`/pokemon/${item.name}`}
                className="border-border bg-card hover:bg-muted flex h-full flex-col rounded-2xl border p-4"
              >
                <span className="text-muted-foreground font-mono text-xs">
                  {pokemonNumber(item.id)}
                </span>
                <PokemonArtwork
                  name={item.name}
                  src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${item.id}.png`}
                  fallback={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${item.id}.png`}
                  className="mx-auto aspect-square w-full object-contain"
                />
                <span className="font-semibold">{pokemonName(item.name)}</span>
              </a>
            </li>
          ))}
        </ul>
        {matches.length === 0 && <p className="py-12 text-center">Try another name or number.</p>}
        {limit < matches.length && (
          <button
            type="button"
            onClick={() => setLimit((value) => value + 48)}
            className="border-border mx-auto mt-8 block rounded-full border px-6 py-3"
          >
            Show more Pokémon
          </button>
        )}
      </main>
      <Layout.AfterBlocks />
    </div>
  );
}
