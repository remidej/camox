import * as React from "react";

type RenderEditingFallback = (page: {
  derived: boolean;
  children: React.ReactNode;
}) => React.ReactNode;

/**
 * Renders the read-only page while the editor is still loading. The Studio
 * chrome provides it, so visitors never download it.
 */
export const EditingFallbackContext = React.createContext<RenderEditingFallback | null>(null);

/** The read-only page shown until the editor activates, laid out for the Canvas when it shows. */
export function EditingFallbackSlot({
  derived,
  children,
}: {
  derived: boolean;
  children: React.ReactNode;
}) {
  const render = React.use(EditingFallbackContext);
  if (!render) return children;
  return render({ derived, children });
}
