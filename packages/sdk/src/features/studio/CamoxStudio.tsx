import * as React from "react";

import { Navigate, useLocation } from "@/features/navigation/navigation";
import { useAuthState, useSignInRedirect } from "@/lib/auth";

import { STUDIO_BASE_PATH } from "./routes";

const CamoxStudio = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, isLoading: isLoadingAuth } = useAuthState();
  const { pathname } = useLocation();
  const signInRedirect = useSignInRedirect();

  React.useEffect(() => {
    if (!isAuthenticated && !isLoadingAuth) {
      signInRedirect();
    }
  }, [isAuthenticated, isLoadingAuth, signInRedirect]);

  if (!isAuthenticated) {
    return null;
  }

  if (pathname === STUDIO_BASE_PATH) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

export { CamoxStudio };
