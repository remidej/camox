/**
 * PROTOTYPE (#203), throwaway: "How should the studio look and behave with
 * drafts?" Five variants of the navbar's draft picker, publish group and
 * publish confirmation, switchable with `?variant=A|B|C|D|E` and the floating bar.
 * Drafts are fake and in memory; use the bar's buttons to edit, publish over
 * the current draft from elsewhere, and toggle a development studio.
 */
import { Toaster } from "@camox/ui/toaster";
import { useSelector } from "@xstate/store-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";

import { useApplyTheme } from "../../useTheme";
import { TOASTER_ID } from "./shared";
import { draftsStore } from "./store";
import * as A from "./VariantA";
import * as B from "./VariantB";
import * as C from "./VariantC";
import * as D from "./VariantD";
import * as E from "./VariantE";

const variants = { A, B, C, D, E } as const;
type Key = keyof typeof variants;
const keys = Object.keys(variants) as Key[];

function readVariant(): Key {
  if (typeof window === "undefined") return "A";
  const value = new URLSearchParams(window.location.search).get("variant");
  return keys.includes(value as Key) ? (value as Key) : "A";
}

let currentVariant: Key = readVariant();
const listeners = new Set<() => void>();

function setVariant(key: Key) {
  currentVariant = key;
  const url = new URL(window.location.href);
  url.searchParams.set("variant", key);
  window.history.replaceState(window.history.state, "", url);
  for (const listener of listeners) listener();
}

function useVariant() {
  return React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => currentVariant,
    () => "A" as Key,
  );
}

export const enabled = process.env.NODE_ENV !== "production";

export function DraftsLeft() {
  const { Left } = variants[useVariant()];
  return <Left />;
}

export function DraftsRight() {
  const { Right } = variants[useVariant()];
  return <Right />;
}

export function DraftsBanner() {
  const variant = variants[useVariant()];
  if (!("Banner" in variant)) return null;
  const { Banner } = variant;
  return <Banner />;
}

export function PrototypeSwitcher() {
  const variant = useVariant();
  const context = useSelector(draftsStore, (state) => state.context);
  const [showState, setShowState] = React.useState(false);
  const { resolvedTheme } = useApplyTheme();
  const draft = context.drafts.find((d) => d.id === context.current);

  const cycle = React.useCallback(
    (step: number) => {
      const index = keys.indexOf(variant);
      setVariant(keys[(index + step + keys.length) % keys.length]!);
    },
    [variant],
  );

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) return;
      if (event.key === "ArrowLeft") cycle(-1);
      if (event.key === "ArrowRight") cycle(1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cycle]);

  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <>
      <div className="camox-studio-theme fixed bottom-20 left-3 z-[60] flex flex-col items-start gap-2 font-sans">
        {showState && (
          <pre className="max-h-64 w-[32rem] overflow-auto rounded-lg bg-zinc-900 p-3 text-[11px] text-zinc-100 shadow-xl">
            {JSON.stringify(
              {
                viewing: draft ? `${draft.id} (${draft.name ?? "unnamed"})` : "live",
                studio: context.studio,
                live: context.live,
                drafts: context.drafts.map((d) => ({
                  id: d.id,
                  name: d.name,
                  by: d.creator.name,
                  changes: d.changes.length,
                  conflicts: d.conflicts.length,
                  lost: d.lost.length,
                  duplicatePaths: d.duplicatePaths.length,
                })),
              },
              null,
              2,
            )}
          </pre>
        )}
        <div className="flex items-center gap-1 rounded-full bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 shadow-xl ring-1 ring-white/10">
          <button
            type="button"
            className="rounded-full p-1 hover:bg-white/10"
            onClick={() => cycle(-1)}
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="min-w-44 text-center font-medium">
            {variant} · {variants[variant].name}
          </span>
          <button
            type="button"
            className="rounded-full p-1 hover:bg-white/10"
            onClick={() => cycle(1)}
          >
            <ChevronRight className="size-4" />
          </button>
          <span className="mx-1 h-4 w-px bg-white/20" />
          <BarButton onClick={() => draftsStore.send({ type: "edit" })}>Edit content</BarButton>
          <BarButton
            disabled={!draft}
            onClick={() => draftsStore.send({ type: "livePublishedElsewhere" })}
          >
            Someone publishes
          </BarButton>
          {draft && draft.duplicatePaths.length > 0 && (
            <BarButton onClick={() => draftsStore.send({ type: "fixDuplicatePath", id: draft.id })}>
              Fix path
            </BarButton>
          )}
          <BarButton onClick={() => draftsStore.send({ type: "toggleStudio" })}>
            {context.studio === "production" ? "Prod studio" : "Dev studio"}
          </BarButton>
          <BarButton onClick={() => draftsStore.send({ type: "reset" })}>Reset</BarButton>
          <BarButton onClick={() => setShowState((s) => !s)}>
            {showState ? "Hide" : "State"}
          </BarButton>
        </div>
      </div>
      <Toaster id={TOASTER_ID} theme={resolvedTheme} />
    </>,
    document.body,
  );
}

function BarButton(props: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      className="rounded-full px-2 py-1 hover:bg-white/10 disabled:opacity-40"
      {...props}
    />
  );
}
