import { QueryClient } from "@tanstack/react-query";
import { createRouter as createTanstackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

// Import the generated route tree
import { routeTree } from "./routeTree.gen";

// Create a new router instance
export function getRouter() {
  const queryClient = new QueryClient({
    // Keeps data the server just loaded from being refetched on hydration.
    defaultOptions: { queries: { staleTime: 30_000 } },
  });

  const router = createTanstackRouter({
    routeTree,
    defaultPreload: "intent",
    context: { queryClient },
  });

  setupRouterSsrQueryIntegration({
    router,
    queryClient,
    wrapQueryClient: true,
  });

  return router;
}

// Register the router instance for type safety
declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
