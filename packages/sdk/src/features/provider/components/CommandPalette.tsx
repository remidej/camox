import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@camox/ui/command";
import { Kbd } from "@camox/ui/kbd";
import { useSelector } from "@xstate/store-react";
import * as React from "react";

import { formatShortcut } from "@/lib/utils";

import { studioStore } from "../../studio/studioStore";
import { actionsStore, type ActionGroupLabel } from "../actionsStore";

export function CommandPalette() {
  const isOpen = useSelector(studioStore, (state) => state.context.isCommandPaletteOpen);
  const [search, setSearch] = React.useState("");
  const [value, setValue] = React.useState("");
  const actions = useSelector(actionsStore, (state) => state.context.actions);
  const pages = useSelector(studioStore, (state) => state.context.commandPalettePages);
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
      const firstChild = actions.find((a) => a.parentActionId === page && a.checkIfAvailable());
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
      className="top-[12vh] sm:max-w-xl"
      description="Navigate your site and switch settings quickly."
      showCloseButton
    >
      <Command value={value} onValueChange={setValue} className="h-auto max-h-[80dvh] p-0">
        <div className="px-5 pt-5 pr-14 pb-3">
          <h2 className="text-lg font-semibold tracking-tight">Command palette</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Navigate your site and switch settings quickly.
          </p>
        </div>
        <div className="px-4 pb-4">
          <CommandInput
            className="placeholder:text-muted-foreground h-full text-base"
            inputGroupClassName="h-11! border-2 border-primary bg-background rounded-xl! *:data-[slot=input-group-addon]:pl-4!"
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
        </div>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-5 pb-3 text-xs">
          <span className="flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> to navigate
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>↵</Kbd> to select
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>Esc</Kbd> {page ? "to go back" : "to close"}
          </span>
        </div>
        <CommandList className="max-h-[min(24rem,45dvh)] min-h-0 scroll-py-1 px-2 pt-1 pb-2">
          <CommandEmpty className="text-muted-foreground py-8">No results found.</CommandEmpty>
          {Array.from(groupedActions.entries()).map(([groupLabel, groupActions]) => (
            <CommandGroup
              key={groupLabel}
              heading={groupLabel}
              className="mb-2 p-0 last:mb-0 **:[[cmdk-group-heading]]:px-3 **:[[cmdk-group-heading]]:py-2 **:[[cmdk-group-heading]]:text-[11px] **:[[cmdk-group-heading]]:tracking-widest **:[[cmdk-group-heading]]:uppercase"
            >
              {groupActions.map((action) => {
                return (
                  <CommandItem
                    key={action.id}
                    keywords={action.aliases}
                    onSelect={() => handleSelect(action.id)}
                    className="min-h-10 justify-between gap-3 px-3 py-2 text-sm"
                    hideCheck
                  >
                    {action.label}
                    {action.shortcut && (
                      <CommandShortcut>{formatShortcut(action.shortcut)}</CommandShortcut>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
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
        aliases: ["Commands", "Search commands"],
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
