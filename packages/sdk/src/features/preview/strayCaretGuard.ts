/** Where the browser would put the caret for a click at this point. */
function caretNodeAt(doc: Document, x: number, y: number): Node | null {
  if (typeof doc.caretPositionFromPoint === "function") {
    return doc.caretPositionFromPoint(x, y)?.offsetNode ?? null;
  }
  // Safari before 18.4 only has the older, non-standard API.
  const legacy = doc as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
  return legacy.caretRangeFromPoint?.(x, y)?.startContainer ?? null;
}

function isEditable(node: Node | null) {
  // The frame's nodes come from another realm: `instanceof Element` misses them.
  const element = node?.nodeType === 1 ? (node as Element) : (node?.parentElement ?? null);
  return element?.closest('[contenteditable=""], [contenteditable="true"]') != null;
}

/**
 * Keep a click beside an editable field from landing in it. On a click over
 * non-editable content, browsers put the caret at the nearest text, and when that
 * text is in a field, they focus it: clicking a block's padding next to a heading
 * starts editing the heading instead of selecting the block. Such a click now only
 * leaves the field being edited, as a click on content without text would.
 */
export function guardStrayCaret(doc: Document) {
  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0) return;
    const target = event.target as Element | null;
    if (!target || isEditable(target)) return;
    if (target.closest?.("input, textarea, select, button")) return;
    if (!isEditable(caretNodeAt(doc, event.clientX, event.clientY))) return;
    // No caret, no focus: the click itself still goes on to select what's under it.
    event.preventDefault();
    const active = doc.activeElement as HTMLElement | null;
    if (active?.isContentEditable) active.blur();
    doc.getSelection()?.removeAllRanges();
  };
  doc.addEventListener("mousedown", onMouseDown, true);
  return () => doc.removeEventListener("mousedown", onMouseDown, true);
}
