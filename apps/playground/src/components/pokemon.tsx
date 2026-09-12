import { useState, type ReactNode } from "react";

const typeColors: Record<string, string> = {
  normal: "#94a3b8",
  fire: "#f97316",
  water: "#3b82f6",
  electric: "#eab308",
  grass: "#22c55e",
  ice: "#06b6d4",
  fighting: "#ef4444",
  poison: "#a855f7",
  ground: "#d97706",
  flying: "#818cf8",
  psychic: "#ec4899",
  bug: "#84cc16",
  rock: "#a16207",
  ghost: "#8b5cf6",
  dragon: "#6366f1",
  dark: "#64748b",
  steel: "#64748b",
  fairy: "#f472b6",
  stellar: "#14b8a6",
};

export function typeColor(type: string) {
  return typeColors[type] ?? "#94a3b8";
}

export function pokemonName(name: string) {
  return name
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function pokemonNumber(id: number) {
  return `#${String(id).padStart(4, "0")}`;
}

export function TypeBadge({ name }: { name: string }) {
  return (
    <a
      href={`/pokemon-types/${name}`}
      className="border-border bg-background/80 text-foreground hover:bg-muted focus-visible:ring-ring inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      <span className="size-2 rounded-full" style={{ backgroundColor: typeColor(name) }} />
      {pokemonName(name)}
    </a>
  );
}

export function PokemonArtwork({
  src,
  fallback,
  name,
  className = "",
  eager = false,
}: {
  src?: string | null;
  fallback?: string | null;
  name: string;
  className?: string;
  eager?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [fallbackFailed, setFallbackFailed] = useState(false);
  const primarySrc = src ?? fallback;
  const currentSrc = failed ? fallback : primarySrc;
  if (!currentSrc || fallbackFailed) {
    return (
      <div
        role="img"
        aria-label={`Artwork unavailable for ${pokemonName(name)}`}
        className={`text-muted-foreground flex items-center justify-center text-5xl font-light ${className}`}
      >
        ?
      </div>
    );
  }
  return (
    <img
      src={currentSrc}
      alt={pokemonName(name)}
      width={475}
      height={475}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      className={`object-contain ${className}`}
      onError={() =>
        failed || primarySrc === fallback ? setFallbackFailed(true) : setFailed(true)
      }
    />
  );
}

export function PokedexHeader({ children }: { children?: ReactNode }) {
  return (
    <div className="border-border mb-8 flex flex-wrap items-center justify-between gap-4 border-b pb-5 sm:mb-12">
      <a
        href="/pokemon/pikachu"
        className="focus-visible:ring-ring inline-flex items-center gap-3 rounded-lg focus-visible:ring-2 focus-visible:outline-none"
      >
        <span
          aria-hidden="true"
          className="border-foreground relative size-7 overflow-hidden rounded-full border-2"
        >
          <span className="bg-foreground absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2" />
          <span className="border-foreground bg-background absolute top-1/2 left-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2" />
        </span>
        <span className="text-sm font-bold tracking-tight">
          The Pokédex <span className="text-muted-foreground ml-1 font-normal">/ Field guide</span>
        </span>
      </a>
      {children}
    </div>
  );
}

export function PokedexCredit() {
  return (
    <div className="border-border text-muted-foreground mt-12 flex flex-wrap items-center justify-between gap-3 border-t pt-5 text-xs">
      <p>A living field guide. Every page is loaded on request.</p>
      <a
        href="https://pokeapi.co/"
        target="_blank"
        rel="noreferrer"
        className="hover:text-foreground underline underline-offset-4"
      >
        Data from PokéAPI ↗
      </a>
    </div>
  );
}
