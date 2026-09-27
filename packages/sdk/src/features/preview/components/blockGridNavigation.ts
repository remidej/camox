/** Move within a non-wrapping grid, clamping down into a short final row. */
export function getGridNavigationIndex(
  index: number,
  count: number,
  columns: number,
  key: string,
): number {
  if (count === 0) return -1;
  if (index < 0) return 0;
  const column = index % columns;
  if (key === "ArrowLeft") return column > 0 ? index - 1 : index;
  if (key === "ArrowRight") {
    return column < columns - 1 ? Math.min(index + 1, count - 1) : index;
  }
  if (key === "ArrowUp") return index >= columns ? index - columns : index;
  if (key === "ArrowDown") {
    const nextRow = (Math.floor(index / columns) + 1) * columns;
    return nextRow < count ? Math.min(index + columns, count - 1) : index;
  }
  return index;
}
