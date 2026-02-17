import * as React from "react";
import type { CamoxApp } from "../../../core/createApp";

const CamoxAppContext = React.createContext<CamoxApp | undefined>(undefined);

export const CamoxAppProvider = ({
  app,
  children,
}: {
  app: CamoxApp;
  children: React.ReactNode;
}) => {
  return (
    <CamoxAppContext.Provider value={app}>{children}</CamoxAppContext.Provider>
  );
};

export function useCamoxApp() {
  const context = React.use(CamoxAppContext);

  if (!context) {
    throw new Error("useCamoxApp must be used within a CamoxAppProvider");
  }

  return context;
}
