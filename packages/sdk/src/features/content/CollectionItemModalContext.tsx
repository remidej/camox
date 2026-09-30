import * as React from "react";

export interface CollectionItemModalTarget {
  collectionId: string;
  itemId?: string;
}

interface CollectionItemModalContextValue {
  close: () => void;
  open: (target: CollectionItemModalTarget) => void;
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
  const close = React.useCallback(() => {
    if (requestedTarget) {
      setRequestedTarget(null);
      return;
    }

    if (routeTarget) onRouteTargetClose(routeTarget);
  }, [onRouteTargetClose, requestedTarget, routeTarget]);
  const value = React.useMemo(() => ({ close, open: setRequestedTarget, target }), [close, target]);

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
