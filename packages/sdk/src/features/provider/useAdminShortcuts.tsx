import { useSelector } from "@xstate/store-react";
import * as React from "react";

import { checkIfInputFocused } from "@/lib/utils";

import { actionsStore } from "./actionsStore";

/**
 * Hook that listens for global keyboard shortcuts defined in the actionsStore
 */
export function useAdminShortcuts() {
  const actions = useSelector(actionsStore, (state) => state.context.actions);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const matchingAction = actions.find((action) => {
        // Not all actions have shortcuts, some are only for the command palette
        if (!action.shortcut) return false;

        // Availability depends on context (e.g. which page the user is on)
        if (!action.checkIfAvailable()) return false;

        const { key, withMeta, withAlt, withShift } = action.shortcut;
        // On Mac, Option+letter produces special characters (e.g. Option+B → "∫"),
        // so we match against the physical key code instead of the composed character.
        const keyMatches =
          withAlt && key.length === 1 && /[a-z]/i.test(key)
            ? event.code === `Key${key.toUpperCase()}`
            : key.toLowerCase() === event.key.toLowerCase();
        return (
          keyMatches &&
          !!withMeta === (event.metaKey || event.ctrlKey) &&
          !!withAlt === event.altKey &&
          !!withShift === event.shiftKey
        );
      });
      if (!matchingAction) return;
      const shortcut = matchingAction.shortcut!;
      if (checkIfInputFocused()) {
        if (shortcut.key !== "Escape" && !shortcut.withMeta && !shortcut.withAlt) return;
        if (shortcut.key === "Backspace") return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (shortcut.key === "Escape" && checkIfInputFocused()) {
        (document.activeElement as HTMLElement).blur();
      }
      matchingAction.execute();
    };

    const handleCapturedKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") return;
      handleKeyDown(event);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      handleKeyDown(event);
    };

    const handleMessage = (event: MessageEvent) => {
      // Handle action execution requests forwarded from iframe
      if (event.data?.type === "executeAction") {
        const { actionId } = event.data;
        const action = actions.find((a) => a.id === actionId);
        if (action) {
          action.execute();
        }
      }
    };

    // Consume shortcuts before field editors can turn Enter into a line break.
    document.addEventListener("keydown", handleCapturedKeyDown, true);
    // Let editors, dialogs, and popovers handle Escape before the global fallback.
    window.addEventListener("keydown", handleEscape);
    window.addEventListener("message", handleMessage);
    return () => {
      document.removeEventListener("keydown", handleCapturedKeyDown, true);
      window.removeEventListener("keydown", handleEscape);
      window.removeEventListener("message", handleMessage);
    };
  }, [actions]);
}
