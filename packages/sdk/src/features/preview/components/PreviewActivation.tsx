import * as React from "react";

/** A replacement preview must load its document and commit before we reveal it. */
export const PreviewActivationContext = React.createContext<(() => void) | undefined>(undefined);

export function PreviewActivation({
  fallback,
  children,
}: {
  fallback: React.ReactNode;
  children: React.ReactNode;
}) {
  const [ready, setReady] = React.useState(false);
  const activate = React.useCallback(() => setReady(true), []);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        className="flex min-h-0 flex-1 flex-col"
        style={{ visibility: ready ? undefined : "hidden" }}
      >
        <PreviewActivationContext.Provider value={activate}>
          <React.Suspense fallback={ready ? fallback : null}>{children}</React.Suspense>
        </PreviewActivationContext.Provider>
      </div>
      {!ready && <div className="absolute inset-0">{fallback}</div>}
    </div>
  );
}
