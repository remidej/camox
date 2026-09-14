import { Kbd } from "@camox/ui/kbd";

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
 * Formats an action shortcut into a keyboard shortcut display component.
 * Automatically detects the platform and uses the appropriate modifier keys.
 *
 * @param shortcut - The shortcut configuration from an Action
 * @returns React element displaying the keyboard shortcut
 *
 * @example
 * ```tsx
 * formatShortcut({ key: "e", withMeta: true }) // Returns <KbdGroup><Kbd>⌘</Kbd><Kbd>E</Kbd></KbdGroup>
 * formatShortcut({ key: "l" })                 // Returns <Kbd>L</Kbd>
 * ```
 */
export function formatShortcut(shortcut: Action["shortcut"]) {
  if (!shortcut) return null;

  return <Shortcut shortcut={shortcut} />;
}

function Shortcut({ shortcut }: { shortcut: NonNullable<Action["shortcut"]> }) {
  const formattedKey = (() => {
    if (shortcut.key === "Enter") return "↵";
    if (shortcut.key === "Escape") return "Esc";
    if (shortcut.key === "Backspace") return "⌫";
    if (shortcut.key === "ArrowUp") return "↑";
    if (shortcut.key === "ArrowDown") return "↓";
    if (shortcut.key === "ArrowLeft") return "←";
    if (shortcut.key === "ArrowRight") return "→";
    return shortcut.key.toUpperCase();
  })();

  const label = (mac: boolean) => {
    const modifiers: string[] = [];
    if (shortcut.withMeta) modifiers.push(mac ? "⌘" : "Ctrl");
    if (shortcut.withAlt) modifiers.push(mac ? "⌥" : "Alt");
    if (shortcut.withShift) modifiers.push(mac ? "⇧" : "Shift");
    return `${modifiers.join()} ${formattedKey}`.trim();
  };

  return (
    <Kbd>
      <PlatformLabel mac={label(true)} other={label(false)} />
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
