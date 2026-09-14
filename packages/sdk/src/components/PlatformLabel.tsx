import { useLayoutEffect } from "react";

import { bootstrapPlatform, PLATFORM_LABEL_CSS } from "../lib/platform";

/** Both variants exist during SSR; the head bootstrap selects one before paint. */
export function PlatformLabel({ mac, other }: { mac: string; other: string }) {
  // Also support client-only/legacy integrations without the runtime head.
  useLayoutEffect(bootstrapPlatform, []);
  return (
    <span>
      <style data-camox-studio>{PLATFORM_LABEL_CSS}</style>
      <span className="camox-platform-mac">{mac}</span>
      <span className="camox-platform-other">{other}</span>
    </span>
  );
}
