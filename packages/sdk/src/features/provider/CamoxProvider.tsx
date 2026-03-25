import { Toaster } from "@camox/ui/toaster";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { ConvexReactClient } from "convex/react";
import * as React from "react";
import studioCssUrl from "virtual:camox-studio-css";

import { AuthGate } from "@/components/AuthGate";
import type { CamoxApp } from "@/core/createApp";
import {
  AuthContext,
  createCamoxAuthClient,
  useAuthActions,
  useProcessOtt,
  useSignInRedirect,
} from "@/lib/auth";

import { usePreviewPagesActions } from "../preview/CamoxPreview";
import { useNavbarActions } from "../studio/components/Navbar";
import { useTheme, useThemeActions } from "../studio/useTheme";
import { CamoxAppProvider } from "./components/CamoxAppContext";
import { CommandPalette, useCommandPaletteActions } from "./components/CommandPalette";
import { useAdminShortcuts } from "./useAdminShortcuts";

interface AuthenticatedCamoxProviderProps {
  children: React.ReactNode;
}

const AuthenticatedCamoxProvider = ({ children }: AuthenticatedCamoxProviderProps) => {
  useAdminShortcuts();

  useCommandPaletteActions();
  useThemeActions();
  useAuthActions();
  useNavbarActions();
  usePreviewPagesActions();

  const { theme } = useTheme();

  return (
    <>
      {children}
      <Toaster theme={theme} />
      <CommandPalette />
    </>
  );
};

const UnauthenticatedCamoxProvider = ({ children }: { children: React.ReactNode }) => {
  const signInRedirect = useSignInRedirect();

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMetaOrCtrl = event.metaKey || event.ctrlKey;

      // Unauthenticated keyboard handler - Cmd+Escape opens sign in
      if (isMetaOrCtrl && event.key === "Escape") {
        event.preventDefault();
        signInRedirect();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [signInRedirect]);

  return (
    <>
      <div className="bg-background min-h-screen">{children}</div>
    </>
  );
};

interface CamoxProviderProps {
  children: React.ReactNode;
  camoxApp: CamoxApp;
  convexUrl: string;
  managementUrl: string;
}

export function CamoxProvider({
  children,
  camoxApp,
  convexUrl,
  managementUrl,
}: CamoxProviderProps) {
  const convexReactClient = React.useMemo(() => new ConvexReactClient(convexUrl), [convexUrl]);
  const authClient = React.useMemo(() => createCamoxAuthClient(managementUrl), [managementUrl]);

  // Verify ?ott= one-time token before the provider mounts, so it doesn't
  // attempt its own cross-domain verify (which needs a Convex-specific endpoint).
  const ottReady = useProcessOtt(authClient);
  if (!ottReady) return null;

  return (
    <AuthContext.Provider value={{ authClient, managementUrl }}>
      <ConvexBetterAuthProvider client={convexReactClient} authClient={authClient}>
        <CamoxAppProvider app={camoxApp}>
          <AuthGate
            authenticated={
              <>
                <link rel="stylesheet" href={studioCssUrl} />
                <AuthenticatedCamoxProvider>{children}</AuthenticatedCamoxProvider>
              </>
            }
            unauthenticated={
              <UnauthenticatedCamoxProvider>{children}</UnauthenticatedCamoxProvider>
            }
          />
        </CamoxAppProvider>
      </ConvexBetterAuthProvider>
    </AuthContext.Provider>
  );
}
