import type { ClassValue } from "clsx";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

import { Kbd, KbdGroup } from "../components/ui/kbd";
import type { Action } from "../features/provider/actionsStore";

export function cn(...inputs: Array<ClassValue>) {
  return twMerge(clsx(inputs));
}

/** Shared focus-ring + validation styles for all input-like elements (Input, Textarea, ContentEditable, etc.) */
export const INPUT_FOCUS_STYLES =
  "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive";

/** Shared base styles for input-like elements (border, text, shadow, transition, outline) */
export const INPUT_BASE_STYLES =
  "border-input placeholder:text-muted-foreground rounded-md border bg-transparent text-base shadow-xs transition-[color,box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm";

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
