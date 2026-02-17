import { createStore } from "@xstate/store";

export type PublicationState = "draft" | "published";

interface StudioContext {
  isCommandPaletteOpen: boolean;
  commandPalettePages: string[];
}

export const studioStore = createStore({
  context: {
    isCommandPaletteOpen: false,
    commandPalettePages: [],
  } as StudioContext,
  on: {
    openCommandPalette: (context) => {
      return {
        ...context,
        isCommandPaletteOpen: true,
      };
    },
    closeCommandPalette: (context) => {
      return {
        ...context,
        isCommandPaletteOpen: false,
        commandPalettePage: null,
      };
    },
    toggleCommandPalette: (context) => {
      return {
        ...context,
        isCommandPaletteOpen: !context.isCommandPaletteOpen,
        commandPalettePages: [],
      };
    },
    pushCommandPalettePage: (context, event: { page: string }) => {
      return {
        ...context,
        commandPalettePages: [...context.commandPalettePages, event.page],
      };
    },
    popCommandPalettePage: (context) => {
      return {
        ...context,
        commandPalettePages: context.commandPalettePages.slice(0, -1),
      };
    },
  },
});
