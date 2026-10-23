import { Kbd } from "@camox/ui/kbd";
import { formatForDisplay, type HotkeyChord } from "@tanstack/react-hotkeys";

import { PlatformLabel } from "../components/PlatformLabel";
import type { Action } from "../features/provider/actionsStore";

export { cn, INPUT_BASE_STYLES, INPUT_FOCUS_STYLES } from "@camox/ui/utils";

export function checkIfInputFocused(document: Document = window.document) {
  return (
    document.activeElement?.tagName === "INPUT" ||
    document.activeElement?.tagName === "TEXTAREA" ||
    (document.activeElement?.getAttribute("contenteditable") ?? "false") === "true"
  );
}

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

/**
 * Gets an action's shortcut component by action ID from the actions array.
 *
 * @param actions - Array of actions from actionsStore
 * @param actionId - The ID of the action to get the shortcut for
 * @returns React element displaying the keyboard shortcut, or null if not found
 *
 * @example
 * ```tsx
 * const actions = useSelector(actionsStore, (state) => state.context.actions);
 * getActionShortcut(actions, "cycle-viewport-mode") // Returns formatted shortcut component
 * ```
 */
export function getActionShortcut(actions: Action[], actionId: string) {
  const action = actions.find((a) => a.id === actionId);
  return action?.shortcut ? formatShortcut(action.shortcut) : null;
}

/**
 * Converts a URL path segment into a human-readable title.
 * Replaces dashes and underscores with spaces and capitalizes each word.
 *
 * @example formatPathSegment("about-us") // "About Us"
 * @example formatPathSegment("studio_ui") // "Studio Ui"
 */
export function formatPathSegment(segment: string): string {
  return segment.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
