import * as React from "react";

export interface CollectionItemModalTarget {
  collectionId: string;
  itemId?: string;
  /** Prefilled content for a new item, e.g. the label typed into a reference picker. */
  initialContent?: Record<string, unknown>;
  /** Called after saving, so a reference picker can attach the newly created item. */
  onSaved?: (item: { id: string }) => void | Promise<void>;
}

interface CollectionItemModalContextValue {
  close: () => void;
  open: (target: CollectionItemModalTarget) => void;
  complete: (target: CollectionItemModalTarget, item: { id: string }) => Promise<void>;
  target: CollectionItemModalTarget | null;
}

const CollectionItemModalContext = React.createContext<CollectionItemModalContextValue | null>(
  null,
);

export function CollectionItemModalProvider({
  children,
  onRouteTargetClose,
  routeTarget = null,
}: {
  children: React.ReactNode;
  onRouteTargetClose: (target: CollectionItemModalTarget) => void;
  routeTarget?: CollectionItemModalTarget | null;
}) {
  const [requestedTarget, setRequestedTarget] = React.useState<CollectionItemModalTarget | null>(
    null,
  );
  const target = requestedTarget ?? routeTarget;
  const activeTarget = React.useRef(target);
  activeTarget.current = target;
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
  const open = React.useCallback((next: CollectionItemModalTarget) => {
    activeTarget.current = next;
    setRequestedTarget(next);
  }, []);
  const complete = React.useCallback(
    async (savedTarget: CollectionItemModalTarget, item: { id: string }) => {
      // A dismissed/replaced modal may still have a draft save in flight.
      // It must not attach an item or close a newer modal when that save returns.
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
    <CollectionItemModalContext.Provider value={value}>
      {children}
    </CollectionItemModalContext.Provider>
  );
}

export function useCollectionItemModal() {
  const context = React.useContext(CollectionItemModalContext);
  if (!context) {
    throw new Error("useCollectionItemModal must be used within CollectionItemModalProvider");
  }
  return context;
}
