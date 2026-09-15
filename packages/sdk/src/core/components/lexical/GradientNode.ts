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

export class GradientNode extends ElementNode {
  static getType(): string {
    return "gradient";
  }
  static clone(node: GradientNode): GradientNode {
    return new GradientNode(node.__key);
  }
  static importJSON(value: SerializedElementNode): GradientNode {
    return $createGradientNode().updateFromJSON(value);
  }
  static importDOM(): DOMConversionMap {
    return {
      span: (element) =>
        element.hasAttribute("data-camox-gradient")
          ? {
              conversion: () => ({ node: $createGradientNode() }),
              priority: 1,
            }
          : null,
    };
  }
  createDOM(): HTMLElement {
    const span = document.createElement("span");
    span.dataset.camoxGradient = "";
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

export function $createGradientNode(): GradientNode {
  return $applyNodeReplacement(new GradientNode());
}

export function $getGradient(node: LexicalNode): GradientNode | null {
  let current: LexicalNode | null = node;
  while (current) {
    if (current instanceof GradientNode) return current;
    current = current.getParent();
  }
  return null;
}

export function $selectionHasGradient(): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;
  if (selection.isCollapsed()) return !!$getGradient(selection.anchor.getNode());
  const texts = selection.getNodes().filter($isTextNode);
  return texts.length > 0 && texts.every((node) => !!$getGradient(node));
}

/** Isolate a selected leaf without removing gradient from its unselected siblings. */
function $removeGradientFrom(node: LexicalNode) {
  const gradient = $getGradient(node);
  if (!gradient) return;
  let branch = node;
  while (branch.getKey() !== gradient.getKey()) {
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
  for (const child of gradient.getChildren()) gradient.insertBefore(child);
  gradient.remove();
}

export function $toggleGradient(): void {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || selection.isCollapsed()) return;
  const remove = $selectionHasGradient();
  const nodes = selection
    .extract()
    .filter((node) => $isTextNode(node) || node.getType() === "linebreak");
  for (const node of nodes) {
    if (remove) {
      $removeGradientFrom(node);
      continue;
    }
    if ($getGradient(node)) continue;
    const previous = node.getPreviousSibling();
    if (previous instanceof GradientNode) {
      previous.append(node);
      continue;
    }
    const gradient = $createGradientNode();
    node.insertBefore(gradient);
    gradient.append(node);
  }
}

/** Keep one background across adjacent runs, including after formatting changes. */
export function $normalizeGradient(node: GradientNode): void {
  const parent = node.getParent();
  if (parent instanceof GradientNode) {
    for (const child of node.getChildren()) node.insertBefore(child);
    node.remove();
    return;
  }
  const next = node.getNextSibling();
  if (next instanceof GradientNode) {
    node.append(...next.getChildren());
    next.remove();
  }
  // Lift a gradient covering an entire link so its background can join adjacent text.
  if ($isElementNode(parent) && parent.getType() === "link" && parent.getChildrenSize() === 1) {
    const children = node.getChildren();
    parent.insertBefore(node);
    parent.append(...children);
    node.append(parent);
  }
}
