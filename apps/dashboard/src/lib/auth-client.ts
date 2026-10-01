import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { oneTimeTokenClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { apiTransportUrl } from "./api-url";

export const authClient = createAuthClient({
  baseURL: apiTransportUrl(
    import.meta.env.VITE_API_URL!,
    import.meta.env.DEV && import.meta.env.SSR,
  ),
  plugins: [organizationClient(), oneTimeTokenClient()],
});

export const { useSession, signIn, signUp, signOut } = authClient;

/**
 * SSR-safe session getter. On the server, forwards the incoming request's
 * cookies to the API so the session is found during SSR. On the client,
 * cookies are sent automatically by the browser.
 */
export const getServerSession = createServerFn({ method: "GET" }).handler(async () => {
  const cookie = getRequestHeader("cookie") ?? "";
  const { data } = await authClient.getSession({
    fetchOptions: { headers: { cookie } },
  });
  return data;
});
