import * as React from "react";

import type { ArtifactData } from "../lib/artifactData";
import {
  connectArtifactHost,
  type ArtifactHost,
  type ArtifactHostOptions,
  type ArtifactStudio,
} from "../lib/artifactHost";

/**
 * The studio context of artifacts rendered outside the editing runtime, such as Block Catalog
 * blocks on the Canvas. Absent on the website, where artifacts see `camox.studio` as `null`.
 */
export const ArtifactStudioContext = React.createContext<ArtifactStudio | null>(null);

/** What a block shares with the host of its artifact's frame. */
export type ArtifactHostInput = {
  studio: ArtifactStudio | null;
  /** The artifact's Artifact Data, from its sibling fields and settings. */
  data?: ArtifactData;
  /** The artifact field's `size`. */
  size: "fill" | "content";
  /** The client router's navigation, for internal paths. */
  navigate: (options: { to: string }) => unknown;
};

/** The render props the host adds to an artifact's `<iframe>`. */
export type ArtifactHostProps = {
  ref: React.RefCallback<HTMLIFrameElement>;
  style?: React.CSSProperties;
};

/**
 * Connects an artifact's `<iframe>` to the `camox` runtime inside it: keeps sharing `studio` and
 * its Artifact Data as they change, sizes frames sized to their content, and routes the
 * artifact's navigation.
 */
export function useArtifactHost({
  studio,
  data = {},
  size,
  navigate,
}: ArtifactHostInput): ArtifactHostProps {
  const host = React.useRef<ArtifactHost | null>(null);
  const latest = React.useRef({ studio, data });
  const latestNavigate = React.useRef(navigate);
  const [height, setHeight] = React.useState<number | null>(null);
  React.useEffect(() => {
    latest.current = { studio, data };
    latestNavigate.current = navigate;
    host.current?.update({ studio, data });
  });
  const ref = React.useCallback(
    (frame: HTMLIFrameElement | null) => {
      if (!frame) return;
      const options: ArtifactHostOptions = {
        size,
        onHeight: setHeight,
        navigate: (path) => void latestNavigate.current({ to: path }),
      };
      const connected = connectArtifactHost(frame, latest.current, options);
      host.current = connected;
      return () => {
        connected.disconnect();
        if (host.current === connected) host.current = null;
      };
    },
    [size],
  );
  if (size !== "content" || height === null) return { ref };
  return { ref, style: { height } };
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
