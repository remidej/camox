/**
 * A line on a frame header's title row, filling the rest of its slot: the
 * space reserved for the item, whatever the device.
 */
export function CanvasHeaderRule() {
  return <span aria-hidden className="bg-border h-0.5 min-w-4 flex-1" />;
}
