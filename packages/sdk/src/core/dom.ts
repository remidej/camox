/** The browsing context that owns a rendered element. */
export interface ElementContext {
  document: Document;
  window: Window & typeof globalThis;
}

/**
 * Resolve DOM APIs from an element rather than the component's JavaScript realm.
 * In Camox preview, elements belong to an iframe but component globals belong
 * to the editor. Call this after mounting (for example, inside an effect).
 *
 * Returns null for a missing element or a document without a window. Never
 * falls back to globals. This does not convert objects into the target realm.
 */
export function getElementContext(element: Element | null | undefined): ElementContext | null {
  if (!element) return null;

  const document = element.ownerDocument;
  const window = document.defaultView;
  if (!window) return null;

  return { document, window };
}
