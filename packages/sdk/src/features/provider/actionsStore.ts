import { createStore } from "@xstate/store";
import type * as icons from "lucide-react";

type IconKey = keyof typeof icons;
export type ActionGroupLabel =
  | "Preview"
  | "Studio"
  | "Navigation"
  | "Invisible";

export interface Action {
  id: string;
  label: string;
  groupLabel: ActionGroupLabel;
  shortcut?: { key: string; withMeta?: boolean; withAlt?: boolean; withShift?: boolean };
  icon?: IconKey;
  parentActionId?: string;
  hasChildren?: boolean;
  execute: () => void;
  checkIfAvailable: () => boolean;
}

export const actionsStore = createStore({
  context: { actions: [] } as { actions: Action[] },
  on: {
    registerAction: (context, event: { action: Action }) => {
      if (context.actions.find((action) => action.id === event.action.id)) {
        return context;
      }
      return { ...context, actions: [...context.actions, event.action] };
    },
    unregisterAction: (context, event: { id: string }) => {
      return {
        ...context,
        actions: context.actions.filter((action) => action.id !== event.id),
      };
    },
    registerManyActions: (context, event: { actions: Action[] }) => {
      const newActions = event.actions.filter(
        (newAction) =>
          !context.actions.find((action) => action.id === newAction.id)
      );
      return { ...context, actions: [...context.actions, ...newActions] };
    },
    unregisterManyActions: (context, event: { ids: string[] }) => {
      return {
        ...context,
        actions: context.actions.filter(
          (action) => !event.ids.includes(action.id)
        ),
      };
    },
  },
});
