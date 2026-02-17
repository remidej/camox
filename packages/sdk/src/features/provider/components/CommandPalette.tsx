import * as React from "react";
import { useSelector } from "@xstate/store/react";
import { actionsStore, type ActionGroupLabel } from "../actionsStore";
import { studioStore } from "../../studio/studioStore";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn, formatShortcut } from "@/lib/utils";
import * as icons from "lucide-react";

export function CommandPalette() {
  const isOpen = useSelector(
    studioStore,
    (state) => state.context.isCommandPaletteOpen,
  );
  const [search, setSearch] = React.useState("");
  const [value, setValue] = React.useState("");
  const actions = useSelector(actionsStore, (state) => state.context.actions);
  const pages = useSelector(
    studioStore,
    (state) => state.context.commandPalettePages,
  );
  const page = pages.at(-1);

  // Group actions by their groupLabel, filtering out "Invisible" actions
  const groupedActions = React.useMemo(() => {
    const availableActions = actions.filter((action) => {
      if (!action.checkIfAvailable()) return false;
      if (action.groupLabel === "Invisible") return false;

      if (page) {
        return action.parentActionId === page;
      }
      if (search.length > 0) {
        return true;
      }
      return !action.parentActionId;
    });

    const groups = new Map<ActionGroupLabel, typeof availableActions>();

    for (const action of availableActions) {
      const existing = groups.get(action.groupLabel) || [];
      groups.set(action.groupLabel, [...existing, action]);
    }

    // Define the order of importance for groups
    const groupOrder: ActionGroupLabel[] = ["Preview", "Navigation", "Studio"];

    // Sort groups by the defined order
    const sortedGroups = new Map<ActionGroupLabel, typeof availableActions>();
    for (const groupLabel of groupOrder) {
      if (groups.has(groupLabel)) {
        sortedGroups.set(groupLabel, groups.get(groupLabel)!);
      }
    }

    return sortedGroups;
  }, [actions, page, search]);

  // When navigating to a parent page, set the command value to the first child
  React.useEffect(() => {
    if (page) {
      const firstChild = actions.find(
        (a) => a.parentActionId === page && a.checkIfAvailable(),
      );
      if (firstChild) {
        setValue(firstChild.id);
      }
    }
  }, [page, actions]);

  const handleSelect = (actionId: string) => {
    const action = actions.find((a) => a.id === actionId);
    if (!action) return;

    action.execute();
    setSearch("");
    if (action.hasChildren) {
      studioStore.send({
        type: "pushCommandPalettePage",
        page: action.id,
      });
    } else {
      studioStore.send({ type: "closeCommandPalette" });
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (open) {
      studioStore.send({ type: "openCommandPalette" });
    } else {
      setValue("");
      studioStore.send({ type: "closeCommandPalette" });
    }
  };

  return (
    <CommandDialog
      open={isOpen}
      onOpenChange={handleOpenChange}
      value={value}
      onValueChange={setValue}
    >
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder="Type a command or search..."
        onKeyDown={(e) => {
          // Escape goes to previous page
          // Backspace goes to previous page when search is empty
          if (e.key === "Escape" || (e.key === "Backspace" && !search)) {
            e.preventDefault();
            studioStore.send({ type: "popCommandPalettePage" });
          }
        }}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {Array.from(groupedActions.entries()).map(
          ([groupLabel, groupActions]) => (
            <CommandGroup key={groupLabel} heading={groupLabel}>
              {groupActions.map((action) => {
                const Icon = action.icon
                  ? (icons[action.icon] as React.ElementType)
                  : null;
                return (
                  <CommandItem
                    key={action.id}
                    onSelect={() => handleSelect(action.id)}
                    className="justify-between"
                  >
                    <div className="flex gap-2 items-center">
                      {Icon && <Icon className="size-4" />}
                      <span className={cn(!Icon && "ml-7")}>
                        {action.label}
                      </span>
                    </div>
                    {action.shortcut && formatShortcut(action.shortcut)}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ),
        )}
      </CommandList>
    </CommandDialog>
  );
}

export function useCommandPaletteActions() {
  React.useEffect(() => {
    // Register command palette action
    actionsStore.send({
      type: "registerAction",
      action: {
        id: "toggle-command-palette",
        label: "Toggle command palette",
        groupLabel: "Invisible",
        checkIfAvailable: () => true,
        execute: () => {
          studioStore.send({ type: "toggleCommandPalette" });
        },
        shortcut: { key: "k", withMeta: true },
      },
    });

    return () => {
      actionsStore.send({
        type: "unregisterAction",
        id: "toggle-command-palette",
      });
    };
  }, []);
}
