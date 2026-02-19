import { createStore } from "@xstate/store";
import { toast } from "@/components/ui/toaster";
import { Block } from "@/core/createBlock";
import { Id } from "camox/_generated/dataModel";
import type { FieldType } from "@/core/lib/fieldTypes";

export type PublicationState = "draft" | "published";

export type SelectionBreadcrumb = {
  type: FieldType | "Block";
  id: string;
  fieldName?: string;
};

interface PreviewContext {
  isPresentationMode: boolean;
  isSidebarOpen: boolean;
  isPageContentSheetOpen: boolean;
  isAddBlockSheetOpen: boolean;
  isContentLocked: boolean;
  isMobileMode: boolean;
  publicationState: PublicationState;
  peekedBlock: Block | null;
  peekedBlockPosition: string | null;
  peekedPagePathname: string | null;
  skipPeekedBlockExitAnimation: boolean;
  selectionBreadcrumbs: SelectionBreadcrumb[];
  iframeElement: HTMLIFrameElement | null;
}

export const previewStore = createStore({
  context: {
    isPresentationMode: false,
    isSidebarOpen: true,
    isPageContentSheetOpen: false,
    isAddBlockSheetOpen: false,
    isContentLocked: false,
    isMobileMode: false,
    publicationState: "draft",
    peekedBlock: null,
    peekedBlockPosition: null,
    peekedPagePathname: null,
    skipPeekedBlockExitAnimation: false,
    selectionBreadcrumbs: [],
    iframeElement: null,
  } as PreviewContext,
  on: {
    enterPresentationMode: (context, _, enqueue) => {
      if (context.isPresentationMode) {
        return context;
      }

      enqueue.effect(() => {
        toast(
          "Entering presentation mode. Press ⌘ + Escape to restore admin interface",
          { duration: 4000 },
        );
      });

      return {
        ...context,
        isPresentationMode: true,
      };
    },
    exitPresentationMode: (context, _, enqueue) => {
      if (!context.isPresentationMode) {
        return context;
      }

      enqueue.effect(() => {
        toast("Leaving presentation mode");
      });

      return {
        ...context,
        isPresentationMode: false,
      };
    },
    toggleSidebar: (context) => {
      if (context.isPresentationMode) {
        // It makes no sense to toggle the editing panel in presentation mode since it's not visible
        return context;
      }

      return {
        ...context,
        isSidebarOpen: !context.isSidebarOpen,
      };
    },
    setContentLocked: (context, event: { value: boolean }) => ({
      ...context,
      isContentLocked: event.value,
    }),
    toggleLockContent: (context, _, enqueue) => {
      enqueue.effect(() => {
        toast(
          context.isContentLocked ? "Unlocking content" : "Locking content",
        );
      });

      if (context.publicationState === "published" && context.isContentLocked) {
        enqueue.effect(() => {
          toast(
            "Can't unlock content while in published mode. Switch to draft mode first.",
          );
        });
        return context;
      }

      return {
        ...context,
        isContentLocked: !context.isContentLocked,
      };
    },
    toggleMobileMode: (context, _, enqueue) => {
      enqueue.effect(() => {
        toast(
          context.isMobileMode ? "Leaving mobile mode" : "Entering mobile mode",
        );
      });

      return {
        ...context,
        isMobileMode: !context.isMobileMode,
      };
    },
    setPublicationState: (
      context,
      event: { value: PublicationState },
      enqueue,
    ) => {
      if (event.value === "draft" && context.publicationState !== "draft") {
        enqueue.effect(() => {
          toast("Switching to draft content");
        });
        return {
          ...context,
          publicationState: event.value,
          isContentLocked: false,
        };
      }

      if (
        event.value === "published" &&
        context.publicationState !== "published"
      ) {
        enqueue.effect(() => {
          toast("Switching to publicly available content");
        });
        return {
          ...context,
          publicationState: event.value,
          isContentLocked: true,
        };
      }
      return context;
    },
    setPeekedBlock: (
      context,
      event: { block: Block; afterPosition?: string | null },
    ) => {
      if (!event.block) {
        return context;
      }

      return {
        ...context,
        peekedBlock: event.block,
        peekedBlockPosition: event.afterPosition ?? null,
      };
    },
    exitPeekedBlock: (context) => {
      return {
        ...context,
        peekedBlock: null,
        peekedBlockPosition: null,
        isAddBlockSheetOpen: false,
      };
    },
    clearPeekedBlock: (context) => {
      return {
        ...context,
        peekedBlock: null,
        peekedBlockPosition: null,
      };
    },
    setSelection: (context, event: { breadcrumbs: SelectionBreadcrumb[] }) => {
      return {
        ...context,
        selectionBreadcrumbs: event.breadcrumbs,
      };
    },
    setFocusedBlock: (context, event: { blockId: Id<"blocks"> }) => {
      return {
        ...context,
        selectionBreadcrumbs: [{ type: "Block" as const, id: event.blockId }],
        peekedBlock: null,
        peekedBlockPosition: null,
        isAddBlockSheetOpen: false,
      };
    },
    setSelectedRepeatableItem: (
      context,
      event: {
        blockId: Id<"blocks">;
        itemId: Id<"repeatableItems">;
        fieldName?: string;
      },
    ) => {
      return {
        ...context,
        selectionBreadcrumbs: [
          { type: "Block" as const, id: event.blockId },
          {
            type: "RepeatableObject" as const,
            id: event.itemId,
            fieldName: event.fieldName,
          },
        ],
      };
    },
    drillIntoRepeatableItem: (
      context,
      event: { itemId: string; fieldName: string },
    ) => {
      return {
        ...context,
        selectionBreadcrumbs: [
          ...context.selectionBreadcrumbs,
          {
            type: "RepeatableObject" as const,
            id: event.itemId,
            fieldName: event.fieldName,
          },
        ],
      };
    },
    drillIntoLink: (context, event: { fieldName: string }) => {
      return {
        ...context,
        selectionBreadcrumbs: [
          ...context.selectionBreadcrumbs,
          {
            type: "Link" as const,
            id: event.fieldName,
            fieldName: event.fieldName,
          },
        ],
      };
    },
    navigateBreadcrumb: (context, event: { depth: number }) => {
      return {
        ...context,
        selectionBreadcrumbs: context.selectionBreadcrumbs.slice(
          0,
          event.depth + 1,
        ),
      };
    },
    setSelectedField: (
      context,
      event: { blockId: Id<"blocks">; fieldName: string; fieldType: FieldType },
    ) => {
      return {
        ...context,
        selectionBreadcrumbs: [
          { type: "Block" as const, id: event.blockId },
          { type: event.fieldType, id: event.fieldName },
        ],
      };
    },
    clearSelection: (context) => {
      return {
        ...context,
        selectionBreadcrumbs: [],
      };
    },
    clearFocusedBlock: (context) => {
      return {
        ...context,
        selectionBreadcrumbs: [],
      };
    },
    selectParentBreadcrumb: (context) => {
      // Remove the last breadcrumb to select the parent
      if (context.selectionBreadcrumbs.length === 0) {
        return context;
      }

      return {
        ...context,
        selectionBreadcrumbs: context.selectionBreadcrumbs.slice(0, -1),
      };
    },
    setPeekedPage: (context, event: { pathname: string }) => {
      return {
        ...context,
        selectionBreadcrumbs: [],
        peekedPagePathname: event.pathname,
      };
    },
    clearPeekedPage: (context) => {
      return {
        ...context,
        peekedPagePathname: null,
      };
    },
    openAddBlockSheet: (context, event: { afterPosition?: string | null }) => {
      return {
        ...context,
        isAddBlockSheetOpen: true,
        peekedBlock: null,
        peekedBlockPosition: event.afterPosition ?? null,
      };
    },
    closeAddBlockSheet: (context) => {
      return {
        ...context,
        isAddBlockSheetOpen: false,
        peekedBlock: null,
        peekedBlockPosition: null,
      };
    },
    focusCreatedBlock: (context, event: { blockId: Id<"blocks"> }) => {
      return {
        ...context,
        selectionBreadcrumbs: [{ type: "Block" as const, id: event.blockId }],
        isAddBlockSheetOpen: false,
        peekedBlock: null,
        peekedBlockPosition: null,
        skipPeekedBlockExitAnimation: true,
      };
    },
    clearSkipPeekedBlockExitAnimation: (context) => {
      return {
        ...context,
        skipPeekedBlockExitAnimation: false,
      };
    },
    toggleContentSheet: (context) => {
      return {
        ...context,
        isPageContentSheetOpen: !context.isPageContentSheetOpen,
      };
    },
    openBlockContentSheet: (context, event: { blockId: Id<"blocks"> }) => {
      const currentBlockMatches =
        context.selectionBreadcrumbs[0]?.id === event.blockId;
      return {
        ...context,
        isPageContentSheetOpen: true,
        selectionBreadcrumbs: currentBlockMatches
          ? context.selectionBreadcrumbs
          : [{ type: "Block" as const, id: event.blockId }],
      };
    },
    closeBlockContentSheet: (context) => {
      return {
        ...context,
        isPageContentSheetOpen: false,
      };
    },
    setIframeElement: (
      context,
      event: { element: HTMLIFrameElement | null },
    ) => {
      return {
        ...context,
        iframeElement: event.element,
      };
    },
  },
});
