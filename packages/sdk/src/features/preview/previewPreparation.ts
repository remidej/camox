import * as React from "react";

export const PreviewPreparationContext = React.createContext<{
  ready: () => void;
  fail: (error: Error) => void;
} | null>(null);
