import { useSelector } from "@xstate/store/react";
import * as React from "react";
import { actionsStore } from "./actionsStore";
import { checkIfInputFocused } from "@/lib/utils";
import { previewStore } from "../preview/previewStore";

/**
 * Hook that listens for global keyboard shortcuts defined in the actionsStore
 */
export function useAdminShortcuts() {
  const actions = useSelector(actionsStore, (state) => state.context.actions);
  const previousLockState = React.useRef<boolean | null>(null);
  const lockKeyDownTime = React.useRef<number | null>(null);
  const HOLD_THRESHOLD_MS = 300;

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Handle L key hold separately
      if (event.key.toLowerCase() === "l" && !event.metaKey && !event.altKey && !event.shiftKey) {
        if (event.repeat) return;
        if (checkIfInputFocused()) return;
        event.preventDefault();
        if (previousLockState.current === null) {
          lockKeyDownTime.current = Date.now();
          previousLockState.current = previewStore.getSnapshot().context.isContentLocked;
          previewStore.send({ type: "setContentLocked", value: true });
        }
        return;
      }

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

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "l") {
        releaseLock();
      }
    };

    const releaseLock = () => {
      if (previousLockState.current === null) return;
      const holdDuration = lockKeyDownTime.current !== null ? Date.now() - lockKeyDownTime.current : Infinity;
      lockKeyDownTime.current = null;
      if (holdDuration < HOLD_THRESHOLD_MS) {
        // Short tap: toggle permanently
        previewStore.send({ type: "setContentLocked", value: !previousLockState.current });
      } else {
        // Long hold: restore previous state
        previewStore.send({ type: "setContentLocked", value: previousLockState.current });
      }
      previousLockState.current = null;
    };

    const handleMessage = (event: MessageEvent) => {
      // Handle L key hold/release forwarded from iframe
      if (event.data?.type === "holdLockContent") {
        if (previousLockState.current === null) {
          lockKeyDownTime.current = Date.now();
          previousLockState.current = previewStore.getSnapshot().context.isContentLocked;
          previewStore.send({ type: "setContentLocked", value: true });
        }
        return;
      }

      if (event.data?.type === "releaseLockContent") {
        releaseLock();
        return;
      }

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
    document.addEventListener("keyup", handleKeyUp);
    window.addEventListener("message", handleMessage);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("message", handleMessage);
    };
  }, [actions]);
}
