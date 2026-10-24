import * as React from "react";

type RenderEditingFallback = (page: { layoutPage: boolean }) => React.ReactNode;

/**
 * Renders what holds the page's place while the editor is still loading. The Studio
 * chrome provides it, so visitors never download it.
 */
export const EditingFallbackContext = React.createContext<RenderEditingFallback | null>(null);

/** What shows until the editor activates, laid out for the Canvas when it shows. */
export function EditingFallbackSlot({ layoutPage }: { layoutPage: boolean }) {
  const render = React.use(EditingFallbackContext);
  return render ? render({ layoutPage }) : null;
}
