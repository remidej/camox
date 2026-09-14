import * as React from "react";

import { Navigate, useLocation } from "@/features/navigation/navigation";
import { useAuthState, useSignInRedirect } from "@/lib/auth";
import { trackClientEvent } from "@/lib/telemetry-client";

import { SharedChromeContext } from "../runtime/SharedChromeContext";
import { Navbar } from "./components/Navbar";
import { STUDIO_BASE_PATH } from "./routes";

const CamoxStudio = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, isLoading: isLoadingAuth } = useAuthState();
  const sharedChrome = React.useContext(SharedChromeContext);
  const { pathname } = useLocation();
  const signInRedirect = useSignInRedirect();

  React.useEffect(() => {
    if (!isAuthenticated && !isLoadingAuth) {
      signInRedirect();
    }
  }, [isAuthenticated, isLoadingAuth, signInRedirect]);

  const hasTrackedOpenRef = React.useRef(false);
  React.useEffect(() => {
    if (!isAuthenticated || hasTrackedOpenRef.current) return;
    hasTrackedOpenRef.current = true;
    trackClientEvent("studio_opened", { route: pathname });
  }, [isAuthenticated, pathname]);

  if (!isAuthenticated) {
    return null;
  }

  if (pathname === STUDIO_BASE_PATH) {
    return <Navigate to="/" replace />;
  }

  if (sharedChrome) return <>{children}</>;

  return (
    <div className="bg-background flex h-screen flex-col overflow-hidden">
      <Navbar />
      {children}
    </div>
  );
};

export { CamoxStudio };
