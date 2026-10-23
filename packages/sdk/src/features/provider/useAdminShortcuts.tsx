import { parseHotkey, useHotkeys, type HotkeyChord } from "@tanstack/react-hotkeys";
import { useSelector } from "@xstate/store-react";

import { checkIfInputFocused } from "@/lib/utils";

import { actionsStore } from "./actionsStore";

/** Listens for the shortcuts of the actions in the actionsStore, on the Studio's window. */
export function useAdminShortcuts() {
  useActionShortcuts(typeof window === "undefined" ? null : window);
}

/**
 * Runs the first available action whose shortcut is pressed in `win`, which may be a preview
 * iframe's window. Shortcuts no available action claims leave the key to the page.
 */
export function useActionShortcuts(win: Window | null) {
  const actions = useSelector(actionsStore, (state) => state.context.actions);
  const shortcuts = [...new Set(actions.flatMap((action) => action.shortcut ?? []))];

  useHotkeys(
    win
      ? shortcuts.map((shortcut) => {
          const { key, ctrl, meta, alt } = parseHotkey(shortcut);
          const escape = key === "Escape";
          return {
            hotkey: shortcut,
            callback: (event: KeyboardEvent) => {
              // Editors, dialogs, and popovers that handled Escape keep it.
              if (escape && event.defaultPrevented) return;
              const action = findAvailableAction(shortcut);
              if (!action) return;
              event.preventDefault();
              event.stopPropagation();
              if (escape && checkIfInputFocused(win.document)) {
                (win.document.activeElement as HTMLElement).blur();
              }
              action.execute();
            },
            options: {
              // Consume shortcuts before field editors can turn Enter into a line break,
              // but let local handlers see Escape before this global fallback.
              target: escape ? win : win.document,
              capture: !escape,
              // Fields keep plain keys, and Backspace to delete text.
              ignoreInputs: key === "Backspace" || (!ctrl && !meta && !alt && !escape),
              preventDefault: false,
              stopPropagation: false,
              conflictBehavior: "allow" as const,
            },
          };
        })
      : [],
  );
}

function findAvailableAction(shortcut: HotkeyChord) {
  return actionsStore
    .getSnapshot()
    .context.actions.find((action) => action.shortcut === shortcut && action.checkIfAvailable());
}
