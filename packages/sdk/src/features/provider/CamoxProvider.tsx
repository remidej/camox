import studioCssUrl from "../../../dist/studio.css?url";

import * as React from "react";
import { SignedIn, SignedOut, useClerk } from "@clerk/clerk-react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { Toaster } from "@/components/ui/toaster";
import { useAdminShortcuts } from "./useAdminShortcuts";
import { AuthProvider, useAuthActions } from "./components/AuthProvider";
import { CamoxAppProvider } from "./components/CamoxAppContext";
import type { CamoxApp } from "@/core/createApp";
import {
  CommandPalette,
  useCommandPaletteActions,
} from "./components/CommandPalette";
import { useNavbarActions } from "../studio/components/Navbar";
import { usePreviewPagesActions } from "../preview/CamoxPreview";
import { useThemeActions } from "../studio/useTheme";

interface AuthenticatedCamoxProviderProps {
  children: React.ReactNode;
}

const AuthenticatedCamoxProvider = ({
  children,
}: AuthenticatedCamoxProviderProps) => {
  // Listen for shortcuts matching registered actions
  useAdminShortcuts();

  /**
   * Register the actions from various features in the app. Their definition is colocated with
   * the logic of the features themselves, but they're registered here so that they are available
   * regardless of which page/component is currently rendered.
   */
  useCommandPaletteActions();
  useThemeActions();
  useAuthActions();
  useNavbarActions();
  usePreviewPagesActions();

  return (
    <>
      {children}
      <Toaster />
      <CommandPalette />
    </>
  );
};

const UnauthenticatedCamoxProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const { openSignIn } = useClerk();

  // This shortcut is intentionnally not registered in useAdminShortcuts and the actionsStore
  // because it's the only one that's for unauthenticated users.
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMetaOrCtrl = event.metaKey || event.ctrlKey;

      // Unauthenticated keyboard handler - Cmd+Escape opens sign in
      if (isMetaOrCtrl && event.key === "Escape") {
        event.preventDefault();
        openSignIn();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [openSignIn]);

  return (
    <>
      <div className="min-h-screen bg-background">{children}</div>
    </>
  );
};

interface CamoxProviderProps {
  children: React.ReactNode;
  camoxApp: CamoxApp;
  convexUrl: string;
}

export function CamoxProvider({
  children,
  camoxApp,
  convexUrl,
}: CamoxProviderProps) {
  const convexReactClient = React.useMemo(
    () => new ConvexReactClient(convexUrl),
    [convexUrl],
  );

  return (
    <ConvexProvider client={convexReactClient}>
      <AuthProvider>
        <CamoxAppProvider app={camoxApp}>
          <SignedIn>
            <link rel="stylesheet" href={studioCssUrl} />
            <AuthenticatedCamoxProvider>{children}</AuthenticatedCamoxProvider>
          </SignedIn>
          <SignedOut>
            <UnauthenticatedCamoxProvider>
              {children}
            </UnauthenticatedCamoxProvider>
          </SignedOut>
        </CamoxAppProvider>
      </AuthProvider>
    </ConvexProvider>
  );
}
