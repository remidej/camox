type MarkedItem = { id: string; parentItemId: string | null; fieldName: string; content: unknown };

/** Point each repeater field of a block and its items at the items stored for it. */
export function injectRepeatableItemMarkers<
  TBlock extends { id: string; content: unknown },
  TItem extends MarkedItem,
>(block: TBlock, blockItems: TItem[]) {
  const childrenByParent = new Map<string | null, Map<string, typeof blockItems>>();
  for (const item of blockItems) {
    let fieldMap = childrenByParent.get(item.parentItemId);
    if (!fieldMap) {
      fieldMap = new Map();
      childrenByParent.set(item.parentItemId, fieldMap);
    }
    const list = fieldMap.get(item.fieldName) ?? [];
    list.push(item);
    fieldMap.set(item.fieldName, list);
  }

  const hasInlineArray = (content: Record<string, unknown>, key: string) => {
    const value = content[key];
    return Array.isArray(value) && value.length > 0;
  };

  const content = { ...(block.content as Record<string, unknown>) };
  const topLevelFields = childrenByParent.get(null);
  if (topLevelFields) {
    for (const [fieldName, fieldItems] of topLevelFields) {
      if (hasInlineArray(content, fieldName)) continue;
      content[fieldName] = fieldItems.map((item) => ({ _itemId: item.id }));
    }
  }

  const items = blockItems.map((item) => {
    const nestedFields = childrenByParent.get(item.id);
    if (!nestedFields) return item;

    const itemContent = { ...(item.content as Record<string, unknown>) };
    for (const [fieldName, fieldItems] of nestedFields) {
      if (hasInlineArray(itemContent, fieldName)) continue;
      itemContent[fieldName] = fieldItems.map((child) => ({ _itemId: child.id }));
    }
    return { ...item, content: itemContent };
  });

  return { block: { ...block, content }, items };
}

/**
 * Nests each item into its parent item's content, under its repeater field, for views that
 * render items in place, such as Markdown. Mutates the items' content.
 */
export function nestChildItems(
  allItems: { id: string; parentItemId: string | null; fieldName: string; content: unknown }[],
) {
  const childrenByParent = new Map<string, Map<string, typeof allItems>>();
  for (const item of allItems) {
    if (item.parentItemId === null) continue;
    let fieldMap = childrenByParent.get(item.parentItemId);
    if (!fieldMap) {
      fieldMap = new Map();
      childrenByParent.set(item.parentItemId, fieldMap);
    }
    const list = fieldMap.get(item.fieldName) ?? [];
    list.push(item);
    fieldMap.set(item.fieldName, list);
  }
  for (const item of allItems) {
    const childFields = childrenByParent.get(item.id);
    if (!childFields) continue;
    const content = item.content as Record<string, unknown>;
    for (const [fieldName, children] of childFields) {
      content[fieldName] = children;
    }
  }
}
