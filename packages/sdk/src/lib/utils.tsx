import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ClassValue } from "clsx";
import { Kbd, KbdGroup } from "../components/ui/kbd";
import type { Action } from "../features/provider/actionsStore";

export function cn(...inputs: Array<ClassValue>) {
  return twMerge(clsx(inputs));
}

export function checkIfInputFocused(document: Document = window.document) {
  return (
    document.activeElement?.tagName === "INPUT" ||
    document.activeElement?.tagName === "TEXTAREA" ||
    (document.activeElement?.getAttribute("contenteditable") ?? "false") ===
      "true"
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

  const isMac = navigator.userAgent.toUpperCase().indexOf("MAC") >= 0;

  const modifiers: string[] = [];
  if (shortcut.withMeta) modifiers.push(isMac ? "⌘" : "Ctrl");
  if (shortcut.withAlt) modifiers.push(isMac ? "⌥" : "Alt");
  if (shortcut.withShift) modifiers.push(isMac ? "⇧" : "Shift");

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

  if (modifiers.length > 0) {
    return (
      <KbdGroup>
        {modifiers.map((mod) => (
          <Kbd key={mod}>{mod}</Kbd>
        ))}
        <Kbd>{formattedKey}</Kbd>
      </KbdGroup>
    );
  }

  return <Kbd>{formattedKey}</Kbd>;
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
 * getActionShortcut(actions, "toggle-mobile-mode") // Returns formatted shortcut component
 * ```
 */
export function getActionShortcut(actions: Action[], actionId: string) {
  const action = actions.find((a) => a.id === actionId);
  return action?.shortcut ? formatShortcut(action.shortcut) : null;
}
