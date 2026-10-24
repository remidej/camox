import { toast } from "@camox/ui/toaster";
import * as React from "react";

/** What the studio tells the editor in a toast. */
export interface StudioNotice {
  tone: "success" | "error";
  message: string;
}

/** Shows a notice in this document's toasts. */
export function showNotice({ tone, message }: StudioNotice) {
  toast[tone](message);
}

/**
 * Where the notices of a page's blocks go. The renderer frame's document shows no toasts: it
 * hands them to the studio, which shows them.
 */
export const StudioNoticeContext = React.createContext<((notice: StudioNotice) => void) | null>(
  null,
);

/** Tells the editor something, in the studio's toasts. */
export function useStudioNotice(): (notice: StudioNotice) => void {
  return React.use(StudioNoticeContext) ?? showNotice;
}
