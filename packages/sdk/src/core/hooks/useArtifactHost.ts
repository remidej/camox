import * as React from "react";

import { connectArtifactHost, type ArtifactHost, type ArtifactStudio } from "../lib/artifactHost";

/**
 * The studio context of artifacts rendered outside the editing runtime, such as Block Catalog
 * blocks on the Canvas. Absent on the website, where artifacts see `camox.studio` as `null`.
 */
export const ArtifactStudioContext = React.createContext<ArtifactStudio | null>(null);

/**
 * A ref for an artifact's `<iframe>` that connects it to the `camox` runtime inside, and keeps
 * sharing `studio` with it as it changes.
 */
export function useArtifactHost(
  studio: ArtifactStudio | null,
): React.RefCallback<HTMLIFrameElement> {
  const host = React.useRef<ArtifactHost | null>(null);
  const latestStudio = React.useRef(studio);
  React.useEffect(() => {
    latestStudio.current = studio;
    host.current?.update({ studio });
  });
  return React.useCallback((frame: HTMLIFrameElement | null) => {
    if (!frame) return;
    const connected = connectArtifactHost(frame, { studio: latestStudio.current });
    host.current = connected;
    return () => {
      connected.disconnect();
      if (host.current === connected) host.current = null;
    };
  }, []);
}
