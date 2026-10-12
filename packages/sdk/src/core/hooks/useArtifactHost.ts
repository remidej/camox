import * as React from "react";

import type { ArtifactData } from "../lib/artifactData";
import { connectArtifactHost, type ArtifactHost, type ArtifactStudio } from "../lib/artifactHost";

/**
 * The studio context of artifacts rendered outside the editing runtime, such as Block Catalog
 * blocks on the Canvas. Absent on the website, where artifacts see `camox.studio` as `null`.
 */
export const ArtifactStudioContext = React.createContext<ArtifactStudio | null>(null);

/**
 * A ref for an artifact's `<iframe>` that connects it to the `camox` runtime inside, and keeps
 * sharing `studio` and its Artifact Data with it as they change.
 */
export function useArtifactHost(
  studio: ArtifactStudio | null,
  data: ArtifactData = {},
): React.RefCallback<HTMLIFrameElement> {
  const host = React.useRef<ArtifactHost | null>(null);
  const latest = React.useRef({ studio, data });
  React.useEffect(() => {
    latest.current = { studio, data };
    host.current?.update({ studio, data });
  });
  return React.useCallback((frame: HTMLIFrameElement | null) => {
    if (!frame) return;
    const connected = connectArtifactHost(frame, latest.current);
    host.current = connected;
    return () => {
      connected.disconnect();
      if (host.current === connected) host.current = null;
    };
  }, []);
}

/**
 * The Artifact Data to inline in an artifact's `srcDoc`: the data its source first rendered
 * with. Later changes reach the artifact through its host, so they never reload the frame; a new
 * source starts again from the current data.
 */
export function useInitialArtifactData(source: unknown, data: ArtifactData): ArtifactData {
  const [initial, setInitial] = React.useState({ source, data });
  if (initial.source === source) return initial.data;
  setInitial({ source, data });
  return data;
}
