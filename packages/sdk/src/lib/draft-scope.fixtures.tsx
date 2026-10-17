import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

import { createDraftScope, type DraftScope, DraftScopeContext } from "./draft-scope";

/** A draft scope on Live, outside any window, for tests that don't follow drafts. */
export function testDraftScope(queryClient = new QueryClient()): DraftScope {
  return createDraftScope({ queryClient, developmentMode: false });
}

/**
 * `QueryClientProvider` for the studio: its components also need the draft scope they view,
 * Live unless `draftScope` says otherwise.
 */
export function StudioQueryClientProvider({
  client,
  draftScope,
  children,
}: {
  client: QueryClient;
  draftScope?: DraftScope;
  children: React.ReactNode;
}) {
  const [liveScope] = React.useState(() => testDraftScope(client));
  return (
    <QueryClientProvider client={client}>
      <DraftScopeContext.Provider value={draftScope ?? liveScope}>
        {children}
      </DraftScopeContext.Provider>
    </QueryClientProvider>
  );
}
