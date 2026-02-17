import { useSelector } from "@xstate/store/react";
import * as React from "react";
import { actionsStore } from "./actionsStore";
import { checkIfInputFocused } from "@/lib/utils";

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
        return (
          key.toLowerCase() === event.key.toLowerCase() &&
          !!(withMeta) === (event.metaKey || event.ctrlKey) &&
          !!(withAlt) === event.altKey &&
          !!(withShift) === event.shiftKey
        );
      });
      if (!matchingAction) return;
      const shortcut = matchingAction.shortcut!;
      if (checkIfInputFocused()) {
        if (!shortcut.withMeta && !shortcut.withAlt) return;
        if (shortcut.key === "Backspace") return;
      }
      event.preventDefault();
      matchingAction.execute();
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

    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("message", handleMessage);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("message", handleMessage);
    };
  }, [actions]);
}
