import * as React from "react";
import {
  isOverlayMessage,
  type OverlayMessage,
} from "../../features/preview/overlayMessages";

/**
 * Listens for a pair of overlay start/end messages on the iframe window and
 * returns whether the "active" (start) state is currently on.
 *
 * Skips setup when `enabled` is false, `iframeWindow` is null, or any value in
 * `match` is undefined.
 */
export function useOverlayMessage(
  iframeWindow: Window | null,
  enabled: boolean,
  startType: OverlayMessage["type"],
  endType: OverlayMessage["type"],
  match: Record<string, string | undefined>,
): boolean {
  const [active, setActive] = React.useState(false);
  const matchJson = JSON.stringify(match);

  React.useEffect(() => {
    if (!enabled || !iframeWindow) return;

    const matchEntries = Object.entries(
      JSON.parse(matchJson) as Record<string, string | undefined>,
    );
    if (matchEntries.some(([, v]) => v === undefined)) return;

    const handleMessage = (event: MessageEvent) => {
      if (!isOverlayMessage(event.data)) return;
      const data = event.data as Record<string, unknown>;
      if (data.type !== startType && data.type !== endType) return;
      if (!matchEntries.every(([k, v]) => data[k] === v)) return;
      setActive(data.type === startType);
    };

    iframeWindow.addEventListener("message", handleMessage);
    return () => iframeWindow.removeEventListener("message", handleMessage);
  }, [enabled, iframeWindow, startType, endType, matchJson]);

  return active;
}
