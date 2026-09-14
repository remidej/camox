export const STUDIO_THEME_STORAGE_KEY = "camox:studio:theme";
export type StudioTheme = "light" | "dark" | "system";

export function readStudioTheme(): StudioTheme {
  try {
    const value = localStorage.getItem(STUDIO_THEME_STORAGE_KEY) ?? localStorage.getItem("theme");
    if (value === "light" || value === "dark") return value;
  } catch {
    // Storage can be unavailable in private/sandboxed browsing.
  }
  return "system";
}

// Self-contained so the exact same implementation can run in the document head
// before styles paint, and from the client theme store after hydration.
export function bootstrapStudioTheme(preference?: StudioTheme) {
  let theme: string = preference ?? "system";
  if (!preference) {
    try {
      theme =
        localStorage.getItem("camox:studio:theme") ?? localStorage.getItem("theme") ?? "system";
    } catch {
      /* use system */
    }
  }
  const dark =
    theme === "dark" || (theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  const resolved = dark ? "dark" : "light";
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  root.dataset.camoxStudioTheme = resolved;
  root.style.colorScheme = resolved;
}

export const STUDIO_THEME_SCRIPT = `(${bootstrapStudioTheme.toString()})();`;
