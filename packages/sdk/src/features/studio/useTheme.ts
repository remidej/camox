import * as React from "react";

import type { Action } from "../provider/actionsStore";
import { actionsStore } from "../provider/actionsStore";
import {
  bootstrapStudioTheme,
  readStudioTheme,
  STUDIO_THEME_STORAGE_KEY,
  type StudioTheme,
} from "./studioTheme";

type Theme = StudioTheme;
type ResolvedTheme = "dark" | "light";

let activeThemeOwnerCount = 0;
const listeners = new Set<() => void>();
let preference: Theme | undefined;

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  return preference ?? readStudioTheme();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify() {
  listeners.forEach((listener) => listener());
}

function applyTheme(theme = readStoredTheme()) {
  bootstrapStudioTheme(theme);
  // The head bootstrap owns the root; the body marker is for studio portals.
  const resolved = document.documentElement.dataset.camoxStudioTheme!;
  document.body.classList.remove("light", "dark");
  document.body.classList.add("camox-studio-theme", resolved);
  document.body.dataset.camoxStudioTheme = resolved;
}

function setTheme(theme: Theme) {
  preference = theme;
  try {
    localStorage.setItem(STUDIO_THEME_STORAGE_KEY, theme);
  } catch {
    /* optional persistence */
  }
  // Also work when storage is unavailable: apply the in-memory preference.
  applyTheme(theme);
  notify();
}

/**
 * Read-only access to the studio theme. Does not mutate `<html>` or localStorage.
 * Use this when you need the current theme value (e.g. to pass to a Toaster) but
 * are not the owner of the studio chrome — applying the theme would bleed onto
 * the host site.
 */
export function useThemeValue(): { theme: Theme } {
  const theme = React.useSyncExternalStore(subscribe, readStoredTheme, () => "system" as Theme);
  return { theme };
}

/**
 * Owns the studio theme: writes the active class onto `<html>` and persists
 * changes to localStorage. Should only be mounted from the studio chrome —
 * never from contexts that share `<html>` with the user's site.
 */
export function useApplyTheme() {
  const theme = React.useSyncExternalStore(subscribe, readStoredTheme, () => "system" as Theme);
  const resolvedTheme = React.useSyncExternalStore(
    subscribe,
    () => (document.documentElement.dataset.camoxStudioTheme === "dark" ? "dark" : "light"),
    () => "light" as ResolvedTheme,
  );

  React.useEffect(() => {
    const root = window.document.documentElement;
    const body = window.document.body;
    activeThemeOwnerCount += 1;

    setTheme(readStoredTheme());
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = () => {
      if (readStoredTheme() === "system") setTheme("system");
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STUDIO_THEME_STORAGE_KEY && event.key !== null) return;
      preference = undefined;
      applyTheme();
      notify();
    };
    mediaQuery.addEventListener("change", updateSystemTheme);
    window.addEventListener("storage", onStorage);
    return () => {
      mediaQuery.removeEventListener("change", updateSystemTheme);
      window.removeEventListener("storage", onStorage);
      activeThemeOwnerCount -= 1;
      if (activeThemeOwnerCount > 0) return;
      root.classList.remove("light", "dark");
      root.style.removeProperty("color-scheme");
      delete root.dataset.camoxStudioTheme;
      body.classList.remove("camox-studio-theme", "light", "dark");
      delete body.dataset.camoxStudioTheme;
    };
  }, []);

  return {
    theme,
    resolvedTheme,
    setTheme,
  };
}

export function useThemeActions() {
  const { theme, setTheme } = useApplyTheme();
  // Register theme switching actions
  React.useEffect(() => {
    const pageId = "change-theme";
    const actions = [
      {
        id: pageId,
        label: "Change theme",
        aliases: ["Theme", "Appearance", "Color mode"],
        groupLabel: "Studio",
        checkIfAvailable: () => true,
        hasChildren: true,
        execute: () => {},
      },
      {
        id: "switch-to-light-theme",
        parentActionId: pageId,
        label: "Switch to light theme",
        aliases: ["Light mode"],
        groupLabel: "Studio",
        checkIfAvailable: () => theme !== "light",
        execute: () => setTheme("light"),
      },
      {
        id: "switch-to-dark-theme",
        parentActionId: pageId,
        label: "Switch to dark theme",
        aliases: ["Dark mode"],
        groupLabel: "Studio",
        checkIfAvailable: () => theme !== "dark",
        execute: () => setTheme("dark"),
      },
      {
        id: "switch-to-system-theme",
        parentActionId: pageId,
        label: "Switch to system theme",
        aliases: ["System mode", "Auto theme"],
        groupLabel: "Studio",
        checkIfAvailable: () => theme !== "system",
        execute: () => setTheme("system"),
      },
    ] satisfies Action[];

    actionsStore.send({ type: "registerManyActions", actions });

    return () => {
      actionsStore.send({
        type: "unregisterManyActions",
        ids: actions.map((a) => a.id),
      });
    };
  }, [theme, setTheme]);
}
