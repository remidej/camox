import * as React from "react";

type RenderEditModeFallback = (page: {
  derived: boolean;
  children: React.ReactNode;
}) => React.ReactNode;

/**
 * Renders the read-only page for Edit Mode while the editor is still loading. The Studio
 * chrome provides it, so visitors never download it.
 */
export const EditModeFallbackContext = React.createContext<RenderEditModeFallback | null>(null);

/** The read-only page shown until the editor activates, laid out for Edit Mode when it's on. */
export function EditModeFallbackSlot({
  derived,
  children,
}: {
  derived: boolean;
  children: React.ReactNode;
}) {
  const render = React.use(EditModeFallbackContext);
  if (!render) return children;
  return render({ derived, children });
}
