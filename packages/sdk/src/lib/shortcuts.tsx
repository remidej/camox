import { Kbd } from "@camox/ui/kbd";
import { formatForDisplay, type HotkeyChord } from "@tanstack/react-hotkeys";

import { PlatformLabel } from "../components/PlatformLabel";

// Kept out of lib/utils so visitors' pages don't load TanStack Hotkeys.

/**
 * Formats a shortcut as a keyboard shortcut display component, labelled for the user's platform.
 *
 * @example
 * ```tsx
 * formatShortcut("Mod+E") // ⌘ E on Mac, Ctrl E elsewhere
 * formatShortcut("L")     // L
 * ```
 */
export function formatShortcut(shortcut: HotkeyChord | undefined) {
  if (!shortcut) return null;
  const label = (platform: "mac" | "windows") =>
    formatForDisplay(shortcut, { platform, separatorToken: " " });

  return (
    <Kbd>
      <PlatformLabel mac={label("mac")} other={label("windows")} />
    </Kbd>
  );
}
