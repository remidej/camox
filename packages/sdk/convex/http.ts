import { httpRouter } from "convex/server";
import { registerRoutes } from "convex-fs";
import { components } from "./_generated/api";
import { fs } from "./fs";

const http = httpRouter();

/* Possibly...
you have other routes here */

// Mount ConvexFS routes at /fs:
// - POST /fs/upload - Upload proxy for Bunny.net storage
// - GET /fs/blobs/{blobId} - Returns 302 redirect to signed CDN URL
registerRoutes(http, components.fs, fs, {
  pathPrefix: "/fs",
  uploadAuth: async () => {
    // TODO: Add real auth check
    return true;
  },
  downloadAuth: async () => {
    // TODO: Add real auth check
    return true;
  },
});

/* Possibly...
you have other routes here */

export default http;
