import {
  ParagraphNode,
  type EditorConfig,
  type SerializedParagraphNode,
} from "lexical";

export class InlineParagraphNode extends ParagraphNode {
  static getType(): string {
    return "inline-paragraph";
  }

  static clone(node: InlineParagraphNode): InlineParagraphNode {
    return new InlineParagraphNode(node.__key);
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement("span");
    const dir = this.getDirection();
    if (dir) span.dir = dir;
    return span;
  }

  updateDOM(): boolean {
    return false;
  }

  static importJSON(
    serializedNode: SerializedParagraphNode,
  ): InlineParagraphNode {
    const node = new InlineParagraphNode();
    node.setDirection(serializedNode.direction);
    node.setFormat(serializedNode.format);
    node.setIndent(serializedNode.indent);
    return node;
  }

  exportJSON(): SerializedParagraphNode {
    return {
      ...super.exportJSON(),
      type: "inline-paragraph",
    };
  }
}
