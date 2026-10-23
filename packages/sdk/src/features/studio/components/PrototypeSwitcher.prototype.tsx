// PROTOTYPE — throwaway. A floating bar to flip between UI variants via `?variant=`.
// Never shown in production builds.
import { ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";

const PARAM = "variant";
const listeners = new Set<() => void>();

const readVariant = () =>
  typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get(PARAM);

let current = readVariant();

function setVariant(next: string) {
  current = next;
  const url = new URL(window.location.href);
  url.searchParams.set(PARAM, next);
  window.history.replaceState(window.history.state, "", url);
  for (const listener of listeners) listener();
}

/** The `?variant=` the page was opened with, kept in memory if the router drops the param. */
export function usePrototypeVariant(): string | null {
  return React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (process.env.NODE_ENV === "production" ? null : current),
    () => null,
  );
}

export function PrototypeSwitcher({
  variants,
  current: key,
  extra,
}: {
  variants: { key: string; name: string }[];
  current: string;
  extra?: React.ReactNode;
}) {
  const index = Math.max(
    0,
    variants.findIndex((variant) => variant.key === key),
  );
  const go = React.useCallback(
    (step: number) => setVariant(variants[(index + step + variants.length) % variants.length]!.key),
    [index, variants],
  );

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  if (process.env.NODE_ENV === "production") return null;
  const variant = variants[index]!;

  return (
    <div className="fixed bottom-4 left-1/2 z-[1000] flex -translate-x-1/2 items-center gap-1 rounded-full bg-black px-1.5 py-1.5 text-sm text-white shadow-2xl ring-2 ring-fuchsia-500">
      <button
        type="button"
        className="rounded-full p-1.5 hover:bg-white/15"
        onClick={() => go(-1)}
        aria-label="Previous variant"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="min-w-56 px-2 text-center tabular-nums">
        <span className="font-semibold">{variant.key}</span>
        <span className="text-white/70"> ({variant.name})</span>
        <span className="text-white/40">
          {" "}
          · {index + 1}/{variants.length}
        </span>
      </span>
      <button
        type="button"
        className="rounded-full p-1.5 hover:bg-white/15"
        onClick={() => go(1)}
        aria-label="Next variant"
      >
        <ChevronRight className="size-4" />
      </button>
      {extra}
    </div>
  );
}
