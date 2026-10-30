import { createStore } from "@xstate/store-react";

interface StudioContext {
  isCommandPaletteOpen: boolean;
  commandPalettePages: string[];
  /** The current draft's review, opened by the pending changes button or the command palette. */
  reviewDraftSheet: { open: boolean; startRenaming: boolean };
  isDeleteDraftDialogOpen: boolean;
  /** The locale picker's dialog open: adding a locale, or removing the one viewed. */
  localeDialog: "add" | "remove" | null;
  /** Where the Website Section was last, so going back to it lands there. */
  websiteLocation: WebsiteLocation | null;
  /**
   * A message for the agent, filled in the chat by "Ask the agent" for the editor to send, until
   * the chat took it. Each has its own id, so asking the same again fills it again.
   */
  agentAsk: { text: string; id: number } | null;
  /** How many times the editor asked the agent, which ids each ask. */
  agentAsks: number;
}

/** A location of the Website Section, in a locale but in no draft. */
export interface WebsiteLocation {
  /** The locale's tag. */
  locale: string;
  /** The path after the locale's prefix. */
  path: string;
  /** The search, without the draft param: going back keeps the draft viewed then. */
  search: string;
  hash: string;
}

export const studioStore = createStore({
  context: {
    isCommandPaletteOpen: false,
    commandPalettePages: [],
    reviewDraftSheet: { open: false, startRenaming: false },
    isDeleteDraftDialogOpen: false,
    localeDialog: null,
    websiteLocation: null,
    agentAsk: null,
    agentAsks: 0,
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
    openDeleteDraftDialog: (context) => {
      return { ...context, isDeleteDraftDialogOpen: true };
    },
    closeDeleteDraftDialog: (context) => {
      return { ...context, isDeleteDraftDialogOpen: false };
    },
    openLocaleDialog: (context, event: { dialog: "add" | "remove" }) => {
      return { ...context, localeDialog: event.dialog };
    },
    closeLocaleDialog: (context) => {
      return { ...context, localeDialog: null };
    },
    // Asking leaves the review, if it's open, for the chat.
    askAgent: (context, event: { text: string }) => {
      return {
        ...context,
        reviewDraftSheet: { open: false, startRenaming: false },
        agentAsk: { text: event.text, id: context.agentAsks + 1 },
        agentAsks: context.agentAsks + 1,
      };
    },
    takeAgentAsk: (context) => {
      return { ...context, agentAsk: null };
    },
    rememberWebsiteLocation: (context, event: { location: WebsiteLocation }) => {
      const previous = context.websiteLocation;
      const { locale, path, search, hash } = event.location;
      if (
        previous?.locale === locale &&
        previous.path === path &&
        previous.search === search &&
        previous.hash === hash
      )
        return context;
      return { ...context, websiteLocation: { locale, path, search, hash } };
    },
  },
});
