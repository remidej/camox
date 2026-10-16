import * as React from "react";

export const PreviewPreparationContext = React.createContext<{
  /**
   * The Canvas is laid out. Unless told otherwise, it restores the viewport handed
   * over from the Preview now; the Preview page frame's slot restores it once the
   * frame is measured in the Canvas.
   */
  ready: (options?: { restore?: boolean }) => void;
  fail: (error: Error) => void;
} | null>(null);
