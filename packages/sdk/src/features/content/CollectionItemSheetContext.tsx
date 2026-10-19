import * as React from "react";

export interface CollectionItemSheetTarget {
  collectionId: string;
  itemId?: string;
  /** Prefilled content for a new item, e.g. the label typed into a reference picker. */
  initialContent?: Record<string, unknown>;
  /** Called after saving, so a reference picker can attach the newly created item. */
  onSaved?: (item: { id: string }) => void | Promise<void>;
}

interface CollectionItemSheetContextValue {
  close: () => void;
  open: (target: CollectionItemSheetTarget) => void;
  complete: (target: CollectionItemSheetTarget, item: { id: string }) => Promise<void>;
  target: CollectionItemSheetTarget | null;
}

const CollectionItemSheetContext = React.createContext<CollectionItemSheetContextValue | null>(
  null,
);

export function CollectionItemSheetProvider({
  children,
  onRouteTargetClose,
  routeTarget = null,
}: {
  children: React.ReactNode;
  onRouteTargetClose: (target: CollectionItemSheetTarget) => void;
  routeTarget?: CollectionItemSheetTarget | null;
}) {
  const [requestedTarget, setRequestedTarget] = React.useState<CollectionItemSheetTarget | null>(
    null,
  );
  const target = requestedTarget ?? routeTarget;
  const activeTarget = React.useRef(target);
  React.useLayoutEffect(() => {
    activeTarget.current = target;
  });
  React.useEffect(
    () => () => {
      activeTarget.current = null;
    },
    [],
  );
  const close = React.useCallback(() => {
    activeTarget.current = null;
    if (requestedTarget) {
      setRequestedTarget(null);
      return;
    }

    if (routeTarget) onRouteTargetClose(routeTarget);
  }, [onRouteTargetClose, requestedTarget, routeTarget]);
  const open = React.useCallback((next: CollectionItemSheetTarget) => {
    activeTarget.current = next;
    setRequestedTarget(next);
  }, []);
  const complete = React.useCallback(
    async (savedTarget: CollectionItemSheetTarget, item: { id: string }) => {
      // A dismissed/replaced sheet may still have a draft save in flight.
      // It must not attach an item or close a newer sheet when that save returns.
      if (activeTarget.current !== savedTarget) return;
      await savedTarget.onSaved?.(item);
      if (activeTarget.current === savedTarget) close();
    },
    [close],
  );
  const value = React.useMemo(
    () => ({ close, open, complete, target }),
    [close, open, complete, target],
  );

  return (
    <CollectionItemSheetContext.Provider value={value}>
      {children}
    </CollectionItemSheetContext.Provider>
  );
}

export function useCollectionItemSheet() {
  const context = React.useContext(CollectionItemSheetContext);
  if (!context) {
    throw new Error("useCollectionItemSheet must be used within CollectionItemSheetProvider");
  }
  return context;
}
