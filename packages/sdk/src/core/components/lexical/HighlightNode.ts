import {
  $applyNodeReplacement,
  $copyNode,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  ElementNode,
  type LexicalNode,
  type DOMConversionMap,
  type SerializedElementNode,
} from "lexical";

export class HighlightNode extends ElementNode {
  static getType(): string {
    return "highlight";
  }
  static clone(node: HighlightNode): HighlightNode {
    return new HighlightNode(node.__key);
  }
  static importJSON(value: SerializedElementNode): HighlightNode {
    return $createHighlightNode().updateFromJSON(value);
  }
  static importDOM(): DOMConversionMap {
    return {
      span: (element) =>
        element.hasAttribute("data-camox-highlight")
          ? {
              conversion: () => ({ node: $createHighlightNode() }),
              priority: 1,
            }
          : null,
    };
  }
  createDOM(): HTMLElement {
    const span = document.createElement("span");
    span.dataset.camoxHighlight = "";
    return span;
  }
  updateDOM(): boolean {
    return false;
  }
  isInline(): boolean {
    return true;
  }
  canBeEmpty(): boolean {
    return false;
  }
  canInsertTextBefore(): boolean {
    return false;
  }
  canInsertTextAfter(): boolean {
    return false;
  }
}

export function $createHighlightNode(): HighlightNode {
  return $applyNodeReplacement(new HighlightNode());
}

export function $getHighlight(node: LexicalNode): HighlightNode | null {
  let current: LexicalNode | null = node;
  while (current) {
    if (current instanceof HighlightNode) return current;
    current = current.getParent();
  }
  return null;
}

export function $selectionHasHighlight(): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;
  if (selection.isCollapsed()) return !!$getHighlight(selection.anchor.getNode());
  const texts = selection.getNodes().filter($isTextNode);
  return texts.length > 0 && texts.every((node) => !!$getHighlight(node));
}

/** Isolate a selected leaf without removing highlight from its unselected siblings. */
function $removeHighlightFrom(node: LexicalNode) {
  const highlight = $getHighlight(node);
  if (!highlight) return;
  let branch = node;
  while (branch.getKey() !== highlight.getKey()) {
    const parent = branch.getParentOrThrow();
    const before = branch.getPreviousSiblings();
    const after = branch.getNextSiblings();
    if (before.length) {
      const clone = $copyNode(parent);
      parent.insertBefore(clone);
      clone.append(...before);
    }
    if (after.length) {
      const clone = $copyNode(parent);
      parent.insertAfter(clone);
      clone.append(...after);
    }
    branch = parent;
  }
  for (const child of highlight.getChildren()) highlight.insertBefore(child);
  highlight.remove();
}

export function $toggleHighlight(): void {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || selection.isCollapsed()) return;
  const remove = $selectionHasHighlight();
  const nodes = selection
    .extract()
    .filter((node) => $isTextNode(node) || node.getType() === "linebreak");
  for (const node of nodes) {
    if (remove) {
      $removeHighlightFrom(node);
      continue;
    }
    if ($getHighlight(node)) continue;
    const previous = node.getPreviousSibling();
    if (previous instanceof HighlightNode) {
      previous.append(node);
      continue;
    }
    const highlight = $createHighlightNode();
    node.insertBefore(highlight);
    highlight.append(node);
  }
}

/** Keep one background across adjacent runs, including after formatting changes. */
export function $normalizeHighlight(node: HighlightNode): void {
  const parent = node.getParent();
  if (parent instanceof HighlightNode) {
    for (const child of node.getChildren()) node.insertBefore(child);
    node.remove();
    return;
  }
  const next = node.getNextSibling();
  if (next instanceof HighlightNode) {
    node.append(...next.getChildren());
    next.remove();
  }
  // Lift a highlight covering an entire link so its background can join adjacent text.
  if ($isElementNode(parent) && parent.getType() === "link" && parent.getChildrenSize() === 1) {
    const children = node.getChildren();
    parent.insertBefore(node);
    parent.append(...children);
    node.append(parent);
  }
}
