import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

import { type ApiClient, getDraftReadClient } from "./api-client";
import { createDraftScope, type DraftScope, DraftScopeContext } from "./draft-scope";
import type { LocaleView } from "./locale-path";
import { createStudioCache, type Read, type StudioCache, StudioCacheContext } from "./studio-reads";

/** A draft scope on Live, outside any window, for tests that don't follow drafts. */
export function testDraftScope(queryClient = new QueryClient()): DraftScope {
  return createDraftScope({ queryClient, developmentMode: false });
}

/** An API whose reads must not happen: tests seed the reads they render. */
const unreachableApi = (() => {
  throw new Error("This test reads the API without seeding the read first");
}) as unknown as (draft: string | null) => ApiClient;

/** A studio cache whose `set` takes partial fixtures: tests seed only what they render. */
export type TestStudioCache = Omit<StudioCache, "set"> & {
  set: (
    read: Read<any, any>,
    value: unknown,
    options?: { in?: string | null; locale?: LocaleView },
  ) => void;
};

/** The studio cache over `queryClient`, for tests seeding and reading through the catalog. */
export function testStudioCache(
  queryClient: QueryClient,
  {
    draftScope = testDraftScope(queryClient),
    api = unreachableApi,
  }: { draftScope?: DraftScope; api?: (draft: string | null) => ApiClient } = {},
): TestStudioCache {
  return createStudioCache({ queryClient, scope: draftScope, api }) as TestStudioCache;
}

/** The key a read is cached under, on Live unless `draft` names a draft. */
export function readKey(read: Read<any, any>, draft: string | null = null) {
  return testStudioCache(new QueryClient()).options(read, { in: draft }).queryKey;
}

/**
 * The draft scope the studio views, Live unless `draftScope` says otherwise, and the studio's
 * reads over `client`, for trees already inside a `QueryClientProvider`.
 */
export function StudioScopeProvider({
  client,
  draftScope,
  api = getDraftReadClient,
  children,
}: {
  client: QueryClient;
  draftScope?: DraftScope;
  /** The API reads fetch through: the window's client by default, as the studio's do. */
  api?: (draft: string | null) => ApiClient;
  children: React.ReactNode;
}) {
  const [liveScope] = React.useState(() => testDraftScope(client));
  const scope = draftScope ?? liveScope;
  const [cache] = React.useState(() => createStudioCache({ queryClient: client, scope, api }));
  return (
    <DraftScopeContext.Provider value={scope}>
      <StudioCacheContext.Provider value={cache}>{children}</StudioCacheContext.Provider>
    </DraftScopeContext.Provider>
  );
}

/**
 * `QueryClientProvider` for the studio: its components also need the draft scope they view,
 * Live unless `draftScope` says otherwise.
 */
export function StudioQueryClientProvider({
  client,
  draftScope,
  api,
  children,
}: {
  client: QueryClient;
  draftScope?: DraftScope;
  api?: (draft: string | null) => ApiClient;
  children: React.ReactNode;
}) {
  return (
    <QueryClientProvider client={client}>
      <StudioScopeProvider client={client} draftScope={draftScope} api={api}>
        {children}
      </StudioScopeProvider>
    </QueryClientProvider>
  );
}
