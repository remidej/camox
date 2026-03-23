import { ConvexFS } from "convex-fs";

import { components } from "./_generated/api";

export const useLocalStorage = !process.env.BUNNY_API_KEY;

export const fs = useLocalStorage
  ? null
  : new ConvexFS(components.fs, {
      storage: {
        type: "bunny",
        apiKey: process.env.BUNNY_API_KEY!,
        storageZoneName: process.env.BUNNY_STORAGE_ZONE!,
        region: process.env.BUNNY_REGION,
        cdnHostname: process.env.BUNNY_CDN_HOSTNAME!,
        tokenKey: process.env.BUNNY_TOKEN_KEY,
      },
    });
