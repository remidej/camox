import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import type { CamoxApp } from "../../core/createApp";
import { initApiClient } from "../../lib/api-client";
import { AuthContext, createCamoxAuthClient, useProcessOtt } from "../../lib/auth";
import { projectQueries, type Project } from "../../lib/queries";
import { CamoxAppProvider } from "./components/CamoxAppContext";

export interface CoreCamoxProviderProps {
  apiUrl: string;
  authenticationUrl: string;
  camoxApp: CamoxApp;
  children: React.ReactNode;
  environmentName?: string;
  projectSlug: string;
  initialAuthenticated?: boolean;
  initialProject?: Project;
}

export function isLocalhostPreview() {
  if (typeof window === "undefined") return false;
  const { hostname } = window.location;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function CoreCamoxProvider({
  apiUrl,
  authenticationUrl,
  camoxApp,
  children,
  environmentName,
  projectSlug,
  initialAuthenticated = false,
  initialProject,
}: CoreCamoxProviderProps) {
  const queryClient = useQueryClient();
  const authClient = React.useMemo(() => createCamoxAuthClient(apiUrl), [apiUrl]);
  const initializedApiUrl = React.useRef<string | null>(null);
  if (initializedApiUrl.current !== apiUrl) {
    initApiClient(apiUrl, environmentName);
    initializedApiUrl.current = apiUrl;
  }

  const seededProject = React.useRef<Project | undefined>(undefined);
  if (initialProject && seededProject.current !== initialProject) {
    queryClient.setQueryData(projectQueries.getBySlug(projectSlug).queryKey, initialProject);
    seededProject.current = initialProject;
  }

  // OTT processing deliberately does not blank the published tree. Successful
  // exchange still reloads after mirroring the server cookie.
  useProcessOtt(authClient);

  return (
    <AuthContext.Provider
      value={{
        authClient,
        authenticationUrl,
        apiUrl,
        projectSlug,
        environmentName,
        initialAuthenticated,
      }}
    >
      <CamoxAppProvider app={camoxApp}>{children}</CamoxAppProvider>
    </AuthContext.Provider>
  );
}
