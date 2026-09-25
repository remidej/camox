Development playground for trying out all Camox APIs. This app is not meant to be deployed — it exists to test and experiment with blocks, layouts, and other Camox features during development.

The playground uses the Camox-owned Nitro runtime. Its authored application surface is:

```txt
src/
  blocks/
  layouts/
  components/
  document.ts
  styles.css
```

Camox owns page routing, SSR, hydration, client navigation, Studio, sitemap, markdown, and OG responses. The app does not define TanStack Start or TanStack Router entries.

## External-data loader example

The Pokémon layouts exercise the ordinary loader contract: `{ kind: "data", data }`.
`Layout.useData()` returns the unwrapped payload, so the UI stays independent of the envelope.

- `/pokedex` loads the directory in a singleton layout.
- `/pokemon/pikachu` loads one Pokémon through typed route parameters.
- `/pokemon-types/electric` loads a type and its Pokémon.
- `/about-camox` remains a singleton without a loader.

With the development services running (`pnpm dev` at the repository root), open `/pokedex`,
search for Pikachu, follow its detail and type links, and refresh each URL. The same
data should render on the server, hydrate without mismatch, and update on client navigation.
Search and “Show more” remain interactive. An unknown Pokémon returns 404; other PokéAPI
errors remain server failures. These examples require access to PokéAPI and the configured
Camox development API. They do not use collections or route discovery.
