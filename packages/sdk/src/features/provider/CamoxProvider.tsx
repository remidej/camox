import * as React from "react";

import { AuthGate } from "../../components/AuthGate";
import type { CamoxApp } from "../../core/createApp";
import { useSignInRedirect } from "../../lib/auth";
import { useLocation } from "../navigation/navigation";
import { STUDIO_BASE_PATH } from "../studio/routes";
import { AuthenticatedCamoxProvider } from "./AuthenticatedCamoxProvider";
import { CoreCamoxProvider, isLocalhostPreview } from "./CoreCamoxProvider";
import { LocalhostPreviewProvider } from "./LocalhostPreviewProvider";

interface CamoxProviderProps {
  apiUrl: string;
  authenticationUrl: string;
  camoxApp: CamoxApp;
  children: React.ReactNode;
  environmentName?: string;
  projectSlug: string;
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

  if (isStudio) return null;
  if (isLocalhostPreview()) {
    return <LocalhostPreviewProvider>{children}</LocalhostPreviewProvider>;
  }
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
