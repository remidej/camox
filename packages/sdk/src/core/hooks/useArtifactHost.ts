import * as React from "react";

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
 * Connects an artifact's `<iframe>` to the `camox` runtime inside it: keeps sharing `studio` as it
 * changes, sizes frames sized to their content, and routes the artifact's navigation.
 */
export function useArtifactHost({ studio, size, navigate }: ArtifactHostInput): ArtifactHostProps {
  const host = React.useRef<ArtifactHost | null>(null);
  const latestStudio = React.useRef(studio);
  const latestNavigate = React.useRef(navigate);
  const [height, setHeight] = React.useState<number | null>(null);
  React.useEffect(() => {
    latestStudio.current = studio;
    latestNavigate.current = navigate;
    host.current?.update({ studio });
  });
  const ref = React.useCallback(
    (frame: HTMLIFrameElement | null) => {
      if (!frame) return;
      const options: ArtifactHostOptions = {
        size,
        onHeight: setHeight,
        navigate: (path) => void latestNavigate.current({ to: path }),
      };
      const connected = connectArtifactHost(frame, { studio: latestStudio.current }, options);
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
