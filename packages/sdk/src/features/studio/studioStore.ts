import { createStore } from "@xstate/store-react";

interface StudioContext {
  isCommandPaletteOpen: boolean;
  commandPalettePages: string[];
  /** The current draft's review, opened by the drafts control or the command palette. */
  reviewDraftSheet: { open: boolean; startRenaming: boolean };
  isDiscardDraftDialogOpen: boolean;
  /** The languages dialog open, from the locale picker or the command palette. */
  languageDialog: "add" | "remove" | null;
}

export const studioStore = createStore({
  context: {
    isCommandPaletteOpen: false,
    commandPalettePages: [],
    reviewDraftSheet: { open: false, startRenaming: false },
    isDiscardDraftDialogOpen: false,
    languageDialog: null,
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
    openReviewDraftSheet: (context, event: { startRenaming?: boolean }) => {
      return {
        ...context,
        reviewDraftSheet: { open: true, startRenaming: event.startRenaming ?? false },
      };
    },
    closeReviewDraftSheet: (context) => {
      return { ...context, reviewDraftSheet: { open: false, startRenaming: false } };
    },
    openDiscardDraftDialog: (context) => {
      return { ...context, isDiscardDraftDialogOpen: true };
    },
    closeDiscardDraftDialog: (context) => {
      return { ...context, isDiscardDraftDialogOpen: false };
    },
    openLanguageDialog: (context, event: { dialog: "add" | "remove" }) => {
      return { ...context, languageDialog: event.dialog };
    },
    closeLanguageDialog: (context) => {
      return { ...context, languageDialog: null };
    },
  },
});
