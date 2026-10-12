import { Window } from "happy-dom";

/** What an artifact sees of its `camox` runtime. */
export type ArtifactWindow = Window & {
  camox: { readonly studio: { editMode: boolean; canvas: boolean } | null };
};

/**
 * Two-realm harness for the host-runtime protocol. The page window holds the artifact frame
 * elements, and each artifact loads its `srcDoc` in its own window. The global `window` is a
 * third window, standing in for the studio, which renders the preview from another realm: host
 * code that reaches for the global `window`, or that compares `event.source` with the frame's
 * `contentWindow`, never connects (happy-dom reports the receiving window as the source).
 */
export function createArtifactPage() {
  const studio = new Window();
  Object.assign(globalThis, { window: studio, document: studio.document });
  const page = new Window();

  return {
    page,
    /** Adds an empty artifact frame element to the page. */
    addFrame() {
      const frame = page.document.createElement("iframe");
      page.document.body.append(frame);
      return frame as unknown as HTMLIFrameElement;
    },
    /** Loads `srcDoc` into the frame as a new artifact document, running its scripts. */
    load(frame: HTMLIFrameElement, srcDoc: string) {
      const artifact = new Window({
        settings: {
          enableJavaScriptEvaluation: true,
          suppressInsecureJavaScriptEnvironmentWarning: true,
        },
      });
      Object.defineProperty(artifact, "parent", { value: page, configurable: true });
      Object.defineProperty(frame, "contentWindow", { value: artifact, configurable: true });
      artifact.document.write(srcDoc);
      return artifact as ArtifactWindow;
    },
    /** Waits until every message in flight between the windows has been delivered. */
    async settle() {
      for (let round = 0; round < 4; round++) {
        await new Promise((resolve) => setTimeout(resolve));
      }
    },
  };
}
