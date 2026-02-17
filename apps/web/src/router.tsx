import { createRouter as createTanstackRouter } from '@tanstack/react-router';

// Import the generated route tree
import { routeTree } from './routeTree.gen';
import { env } from './env';
import { ConvexHttpClient } from 'convex/browser';

const convexHttpClient = new ConvexHttpClient(env.VITE_CONVEX_URL);

// Create a new router instance
export const createRouter = () => {
  const router = createTanstackRouter({
    routeTree,
    context: {
      convexHttpClient,
    },
    defaultPreload: 'intent',
  });

  return router;
};

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createRouter>;
  }
}
