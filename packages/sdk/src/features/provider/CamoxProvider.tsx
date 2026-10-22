import * as React from "react";

import { AuthGate } from "../../components/AuthGate";
import type { CamoxApp } from "../../core/createApp";
import { useSignInRedirect } from "../../lib/auth";
import { useLocation } from "../navigation/navigation";
import { STUDIO_BASE_PATH } from "../studio/routes";
import { AuthenticatedCamoxProvider } from "./AuthenticatedCamoxProvider";
import { CoreCamoxProvider } from "./CoreCamoxProvider";
import { useSignInShortcut } from "./signInShortcut";

interface CamoxProviderProps {
  apiUrl: string;
  authenticationUrl: string;
  camoxApp: CamoxApp;
  children: React.ReactNode;
  projectUuid: string;
}

function UnauthenticatedExperience({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const isStudio = pathname === STUDIO_BASE_PATH || pathname.startsWith(`${STUDIO_BASE_PATH}/`);
  const signInRedirect = useSignInRedirect(() => {
    if (typeof window === "undefined") return undefined;
    if (!isStudio) return window.location.href;
    return new URL("/", window.location.href).href;
  });

  React.useEffect(() => {
    if (isStudio) signInRedirect();
  }, [isStudio, signInRedirect]);
  useSignInShortcut(!isStudio);

  if (isStudio) return null;
  return <div className="bg-background min-h-screen">{children}</div>;
}

export function CamoxProvider(props: CamoxProviderProps) {
  return (
    <CoreCamoxProvider {...props}>
      <AuthGate
        authenticated={<AuthenticatedCamoxProvider>{props.children}</AuthenticatedCamoxProvider>}
        loading={<UnauthenticatedExperience>{props.children}</UnauthenticatedExperience>}
        unauthenticated={<UnauthenticatedExperience>{props.children}</UnauthenticatedExperience>}
      />
    </CoreCamoxProvider>
  );
}
