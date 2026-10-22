import type { QueryClient } from "@tanstack/react-query";
import { notFound } from "@tanstack/react-router";
import { createMiddleware, createServerFn } from "@tanstack/react-start";

import type { CamoxApp } from "../../core/createApp";
import {
  buildClearServerAuthCookieHeader,
  getAuthCookieHeader,
  getServerAuthCookieHeader,
} from "../../lib/auth";
import { CamoxPreview, PageContent } from "../preview/CamoxPreview";
import {
  buildCamoxPageHead,
  createMarkdownResponse,
  prefersMarkdown,
  isNotFoundError,
  loadCamoxPageForRequest,
  type CamoxPageLoaderData,
} from "./pageRuntime";

/* -------------------------------------------------------------------------------------------------
 * Server functions
 * -----------------------------------------------------------------------------------------------*/

export const getOrigin = createServerFn({ method: "GET" }).handler(async () => {
  const { getRequest } = await import("@tanstack/react-start/server");
  const request = getRequest();
  const url = new URL(request.url);
  return url.origin;
});

export const getServerLoaderAuthCookieHeader = createServerFn({ method: "GET" }).handler(
  async () => {
    const { getRequest } = await import("@tanstack/react-start/server");
    return getServerAuthCookieHeader(getRequest().headers);
  },
);

async function clearServerAuthCookie() {
  if (typeof window !== "undefined") return;
  const { setResponseHeader } = await import("@tanstack/react-start/server");
  setResponseHeader("Set-Cookie", buildClearServerAuthCookieHeader());
}

function throwNotFoundOrRethrow(error: unknown): never {
  if (isNotFoundError(error)) throw notFound();
  throw error;
}

/* -------------------------------------------------------------------------------------------------
 * Factories
 * -----------------------------------------------------------------------------------------------*/

export function createMarkdownMiddleware(apiUrl: string, projectUuid: string) {
  return createMiddleware().server(async ({ next, request }) => {
    if (!prefersMarkdown(request.headers.get("Accept") ?? "")) return next();
    const { origin, pathname } = new URL(request.url);
    const response = await createMarkdownResponse({
      apiUrl,
      camoxApp: undefined,
      projectUuid,
      request,
      url: `${origin}${pathname}`,
    });
    if (response) throw response;

    return next();
  });
}

export function createPageLoader(apiUrl: string, projectUuid: string) {
  return async ({
    location,
    context,
  }: {
    location: { pathname: string };
    context: { queryClient: QueryClient };
  }) => {
    const authCookieHeader =
      typeof window !== "undefined"
        ? getAuthCookieHeader()
        : await getServerLoaderAuthCookieHeader();

    try {
      const result = await loadCamoxPageForRequest({
        apiUrl,
        authCookieHeader,
        origin: await getOrigin(),
        pathname: location.pathname,
        projectUuid,
        queryClient: context.queryClient,
      });

      if (result.shouldClearAuthCookie) await clearServerAuthCookie();
      return result.data;
    } catch (error) {
      throwNotFoundOrRethrow(error);
    }
  };
}

export function createPageHead(camoxApp: CamoxApp) {
  return ({ loaderData }: { loaderData?: CamoxPageLoaderData }) => {
    return buildCamoxPageHead(camoxApp, loaderData);
  };
}

/* -------------------------------------------------------------------------------------------------
 * Component
 * -----------------------------------------------------------------------------------------------*/

export const PageRouteComponent = () => {
  return (
    <CamoxPreview>
      <PageContent />
    </CamoxPreview>
  );
};
