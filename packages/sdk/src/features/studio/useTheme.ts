import * as React from "react";
import { actionsStore } from "../provider/actionsStore";
import type { Action } from "../provider/actionsStore";

type Theme = "dark" | "light" | "system";

const getThemeIcon = (theme: Theme): NonNullable<Action["icon"]> => {
  switch (theme) {
    case "dark":
      return "Moon";
    case "light":
      return "Sun";
    case "system":
      return "Monitor";
  }
};

export function useTheme() {
  const [theme, setTheme] = React.useState<Theme>(() => {
    if (typeof window !== "undefined") {
      const storedTheme = localStorage.getItem("theme") as Theme | null;
      return storedTheme || "system";
    }
    return "system";
  });

  const applyTheme = (themeToApply: "dark" | "light") => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(themeToApply);
  };

  React.useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove("light", "dark");

    if (theme === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

      const updateSystemTheme = () => {
        const systemTheme = mediaQuery.matches ? "dark" : "light";
        applyTheme(systemTheme);
      };

      // Apply initial system theme
      updateSystemTheme();

      // Listen for changes to system theme preference
      mediaQuery.addEventListener("change", updateSystemTheme);

      // Cleanup listener
      return () => mediaQuery.removeEventListener("change", updateSystemTheme);
    }

    root.classList.add(theme);
  }, [theme]);

  React.useEffect(() => {
    localStorage.setItem("theme", theme);
  }, [theme]);

  return {
    theme,
    setTheme,
  };
}

export function useThemeActions() {
  const { theme, setTheme } = useTheme();
  // Register theme switching actions
  React.useEffect(() => {
    const pageId = "change-theme";
    const actions = [
      {
        id: pageId,
        label: "Change theme",
        groupLabel: "Studio",
        checkIfAvailable: () => true,
        hasChildren: true,
        execute: () => {},
        icon: getThemeIcon(theme),
      },
      {
        id: "switch-to-light-theme",
        parentActionId: pageId,
        label: "Switch to light theme",
        groupLabel: "Studio",
        checkIfAvailable: () => theme !== "light",
        execute: () => setTheme("light"),
        icon: "Sun",
      },
      {
        id: "switch-to-dark-theme",
        parentActionId: pageId,
        label: "Switch to dark theme",
        groupLabel: "Studio",
        checkIfAvailable: () => theme !== "dark",
        execute: () => setTheme("dark"),
        icon: "Moon",
      },
      {
        id: "switch-to-system-theme",
        parentActionId: pageId,
        label: "Switch to system theme",
        groupLabel: "Studio",
        checkIfAvailable: () => theme !== "system",
        execute: () => setTheme("system"),
        icon: "Monitor",
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
