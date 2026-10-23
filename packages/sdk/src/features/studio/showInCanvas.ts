import * as React from "react";

import { type FieldType, fieldTypesDictionary } from "@/core/lib/fieldTypes";
import { useProjectUuid } from "@/lib/auth";
import { localizedPath } from "@/lib/locale-path";
import { reads, useStudioCache } from "@/lib/studio-reads";
import { useViewLocale } from "@/lib/view-locale-context";

import { useLocation, useNavigate } from "../navigation/navigation";
import {
  previewStore,
  sameEditingOwner,
  type EditingOwner,
  type Selection,
} from "../preview/previewStore";

/**
 * How long showing something in the Canvas keeps selecting it, in milliseconds, while the Canvas
 * mounts and its page's editing frame claims, each of which can clear the selection. A product
 * tuning value: long enough for a page to load, short enough not to fight the editor.
 */
const SELECTING_FOR = 5000;

/** What to show in the Canvas: a page, in a locale, and the block, item and field in it. */
export interface CanvasTarget {
  pageId: string;
  /** The tag of the locale whose content to show, or null for the one viewed. */
  locale: string | null;
  blockId?: string | null;
  itemId?: string | null;
  field?: { name: string; kind: string | null } | null;
}

const isFieldType = (kind: string | null | undefined): kind is FieldType =>
  !!kind && Object.hasOwn(fieldTypesDictionary, kind);

/** What to select on the target's page: its field, else its item or block, else nothing. */
function selectionOf({ blockId, itemId, field }: CanvasTarget): Selection | null {
  if (!blockId) return null;
  const fieldType = field && isFieldType(field.kind) ? field.kind : null;
  if (itemId) {
    return field && fieldType
      ? { type: "item-field", blockId, itemId, fieldName: field.name, fieldType }
      : { type: "item", blockId, itemId };
  }
  return field && fieldType
    ? { type: "block-field", blockId, fieldName: field.name, fieldType }
    : { type: "block", blockId };
}

/** Stops selecting what was last shown in the Canvas. */
let stopSelecting: (() => void) | null = null;

/**
 * Selects `selection` once `owner`'s editing frame is active, and again whenever it's cleared,
 * until the editor selects something else or the time runs out.
 */
function selectOnceShown(owner: EditingOwner, selection: Selection) {
  stopSelecting?.();
  const select = () => {
    const { editingContext } = previewStore.getSnapshot().context;
    if (!sameEditingOwner(editingContext, owner)) return;
    const current = editingContext?.selection ?? null;
    if (current === null) {
      previewStore.send({ type: "selectTarget", ...owner, selection });
      return;
    }
    // Anything else selected on the page is the editor's own choice.
    if (JSON.stringify(current) !== JSON.stringify(selection)) stop();
  };
  const subscription = previewStore.subscribe(select);
  const timer = setTimeout(() => stop(), SELECTING_FOR);
  const stop = () => {
    subscription.unsubscribe();
    clearTimeout(timer);
    if (stopSelecting === stop) stopSelecting = null;
  };
  stopSelecting = stop;
  const { editingContext } = previewStore.getSnapshot().context;
  if (sameEditingOwner(editingContext, owner)) {
    previewStore.send({ type: "selectTarget", ...owner, selection });
  }
}

/**
 * Shows a page in the Canvas, in the target's locale, and selects the block, item or field in it
 * once the page's editing frame is active.
 */
export function useShowInCanvas() {
  const cache = useStudioCache();
  const projectUuid = useProjectUuid();
  const view = useViewLocale();
  const navigate = useNavigate();
  const search = useLocation({ select: (location) => location.search });

  return React.useCallback(
    async (target: CanvasTarget) => {
      const locale = view.locales.find((each) => each.tag === target.locale) ?? view.locale;
      const pages = await cache.ensure(reads.pageList({ projectUuid }), { locale }).catch(() => []);
      const page = pages.find((each) => each.id === target.pageId);
      if (!page) return;
      const selection = selectionOf(target);
      if (selection) selectOnceShown({ kind: "page", pageId: page.id }, selection);
      else stopSelecting?.();
      previewStore.send({ type: "showCanvas" });
      await navigate({ to: `${localizedPath(page.fullPath, locale)}${search}` });
    },
    [cache, navigate, projectUuid, search, view.locale, view.locales],
  );
}
