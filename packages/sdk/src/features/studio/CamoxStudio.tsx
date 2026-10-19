import * as React from "react";

import { Navigate } from "@/features/navigation/navigation";
import { useAuthState, useSignInRedirect } from "@/lib/auth";
import { useLocalePath, useLocalizedPath } from "@/lib/view-locale";

import { STUDIO_BASE_PATH } from "./routes";

const CamoxStudio = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, isLoading: isLoadingAuth } = useAuthState();
  const pathname = useLocalePath();
  const localized = useLocalizedPath();
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
    return <Navigate to={localized("/")} replace />;
  }

  return <>{children}</>;
};

export { CamoxStudio };
