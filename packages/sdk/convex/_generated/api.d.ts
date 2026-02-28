/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as blockDefinitions from "../blockDefinitions.js";
import type * as blocks from "../blocks.js";
import type * as files from "../files.js";
import type * as fs from "../fs.js";
import type * as functions from "../functions.js";
import type * as http from "../http.js";
import type * as pageActions from "../pageActions.js";
import type * as pages from "../pages.js";
import type * as projects from "../projects.js";
import type * as repeatableItems from "../repeatableItems.js";
import type * as seed from "../seed.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  blockDefinitions: typeof blockDefinitions;
  blocks: typeof blocks;
  files: typeof files;
  fs: typeof fs;
  functions: typeof functions;
  http: typeof http;
  pageActions: typeof pageActions;
  pages: typeof pages;
  projects: typeof projects;
  repeatableItems: typeof repeatableItems;
  seed: typeof seed;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  fs: {
    lib: {
      commitFiles: FunctionReference<
        "mutation",
        "internal",
        {
          config: {
            blobGracePeriod?: number;
            downloadUrlTtl?: number;
            storage:
              | {
                  apiKey: string;
                  cdnHostname: string;
                  region?: string;
                  storageZoneName: string;
                  tokenKey?: string;
                  type: "bunny";
                }
              | { type: "test" };
          };
          files: Array<{
            attributes?: { expiresAt?: number };
            basis?: null | string;
            blobId: string;
            path: string;
          }>;
        },
        null
      >;
      copyByPath: FunctionReference<
        "mutation",
        "internal",
        {
          config: {
            blobGracePeriod?: number;
            downloadUrlTtl?: number;
            storage:
              | {
                  apiKey: string;
                  cdnHostname: string;
                  region?: string;
                  storageZoneName: string;
                  tokenKey?: string;
                  type: "bunny";
                }
              | { type: "test" };
          };
          destPath: string;
          sourcePath: string;
        },
        null
      >;
      deleteByPath: FunctionReference<
        "mutation",
        "internal",
        {
          config: {
            blobGracePeriod?: number;
            downloadUrlTtl?: number;
            storage:
              | {
                  apiKey: string;
                  cdnHostname: string;
                  region?: string;
                  storageZoneName: string;
                  tokenKey?: string;
                  type: "bunny";
                }
              | { type: "test" };
          };
          path: string;
        },
        null
      >;
      getDownloadUrl: FunctionReference<
        "action",
        "internal",
        {
          blobId: string;
          config: {
            blobGracePeriod?: number;
            downloadUrlTtl?: number;
            storage:
              | {
                  apiKey: string;
                  cdnHostname: string;
                  region?: string;
                  storageZoneName: string;
                  tokenKey?: string;
                  type: "bunny";
                }
              | { type: "test" };
          };
          extraParams?: Record<string, string>;
        },
        string
      >;
      list: FunctionReference<
        "query",
        "internal",
        {
          config: {
            blobGracePeriod?: number;
            downloadUrlTtl?: number;
            storage:
              | {
                  apiKey: string;
                  cdnHostname: string;
                  region?: string;
                  storageZoneName: string;
                  tokenKey?: string;
                  type: "bunny";
                }
              | { type: "test" };
          };
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          prefix?: string;
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            attributes?: { expiresAt?: number };
            blobId: string;
            contentType: string;
            path: string;
            size: number;
          }>;
        }
      >;
      moveByPath: FunctionReference<
        "mutation",
        "internal",
        {
          config: {
            blobGracePeriod?: number;
            downloadUrlTtl?: number;
            storage:
              | {
                  apiKey: string;
                  cdnHostname: string;
                  region?: string;
                  storageZoneName: string;
                  tokenKey?: string;
                  type: "bunny";
                }
              | { type: "test" };
          };
          destPath: string;
          sourcePath: string;
        },
        null
      >;
      registerPendingUpload: FunctionReference<
        "mutation",
        "internal",
        {
          blobId: string;
          config: {
            blobGracePeriod?: number;
            downloadUrlTtl?: number;
            storage:
              | {
                  apiKey: string;
                  cdnHostname: string;
                  region?: string;
                  storageZoneName: string;
                  tokenKey?: string;
                  type: "bunny";
                }
              | { type: "test" };
          };
          contentType: string;
          size: number;
        },
        null
      >;
      stat: FunctionReference<
        "query",
        "internal",
        {
          config: {
            blobGracePeriod?: number;
            downloadUrlTtl?: number;
            storage:
              | {
                  apiKey: string;
                  cdnHostname: string;
                  region?: string;
                  storageZoneName: string;
                  tokenKey?: string;
                  type: "bunny";
                }
              | { type: "test" };
          };
          path: string;
        },
        null | {
          attributes?: { expiresAt?: number };
          blobId: string;
          contentType: string;
          path: string;
          size: number;
        }
      >;
      transact: FunctionReference<
        "mutation",
        "internal",
        {
          config: {
            blobGracePeriod?: number;
            downloadUrlTtl?: number;
            storage:
              | {
                  apiKey: string;
                  cdnHostname: string;
                  region?: string;
                  storageZoneName: string;
                  tokenKey?: string;
                  type: "bunny";
                }
              | { type: "test" };
          };
          ops: Array<
            | {
                dest: { basis?: null | string; path: string };
                op: "move";
                source: {
                  attributes?: { expiresAt?: number };
                  blobId: string;
                  contentType: string;
                  path: string;
                  size: number;
                };
              }
            | {
                dest: { basis?: null | string; path: string };
                op: "copy";
                source: {
                  attributes?: { expiresAt?: number };
                  blobId: string;
                  contentType: string;
                  path: string;
                  size: number;
                };
              }
            | {
                op: "delete";
                source: {
                  attributes?: { expiresAt?: number };
                  blobId: string;
                  contentType: string;
                  path: string;
                  size: number;
                };
              }
            | {
                attributes: { expiresAt?: null | number };
                op: "setAttributes";
                source: {
                  attributes?: { expiresAt?: number };
                  blobId: string;
                  contentType: string;
                  path: string;
                  size: number;
                };
              }
          >;
        },
        null
      >;
    };
    ops: {
      basics: {
        copyByPath: FunctionReference<
          "mutation",
          "internal",
          {
            config: {
              blobGracePeriod?: number;
              downloadUrlTtl?: number;
              storage:
                | {
                    apiKey: string;
                    cdnHostname: string;
                    region?: string;
                    storageZoneName: string;
                    tokenKey?: string;
                    type: "bunny";
                  }
                | { type: "test" };
            };
            destPath: string;
            sourcePath: string;
          },
          null
        >;
        deleteByPath: FunctionReference<
          "mutation",
          "internal",
          {
            config: {
              blobGracePeriod?: number;
              downloadUrlTtl?: number;
              storage:
                | {
                    apiKey: string;
                    cdnHostname: string;
                    region?: string;
                    storageZoneName: string;
                    tokenKey?: string;
                    type: "bunny";
                  }
                | { type: "test" };
            };
            path: string;
          },
          null
        >;
        list: FunctionReference<
          "query",
          "internal",
          {
            config: {
              blobGracePeriod?: number;
              downloadUrlTtl?: number;
              storage:
                | {
                    apiKey: string;
                    cdnHostname: string;
                    region?: string;
                    storageZoneName: string;
                    tokenKey?: string;
                    type: "bunny";
                  }
                | { type: "test" };
            };
            paginationOpts: {
              cursor: string | null;
              endCursor?: string | null;
              id?: number;
              maximumBytesRead?: number;
              maximumRowsRead?: number;
              numItems: number;
            };
            prefix?: string;
          },
          {
            continueCursor: string;
            isDone: boolean;
            page: Array<{
              attributes?: { expiresAt?: number };
              blobId: string;
              contentType: string;
              path: string;
              size: number;
            }>;
          }
        >;
        moveByPath: FunctionReference<
          "mutation",
          "internal",
          {
            config: {
              blobGracePeriod?: number;
              downloadUrlTtl?: number;
              storage:
                | {
                    apiKey: string;
                    cdnHostname: string;
                    region?: string;
                    storageZoneName: string;
                    tokenKey?: string;
                    type: "bunny";
                  }
                | { type: "test" };
            };
            destPath: string;
            sourcePath: string;
          },
          null
        >;
        stat: FunctionReference<
          "query",
          "internal",
          {
            config: {
              blobGracePeriod?: number;
              downloadUrlTtl?: number;
              storage:
                | {
                    apiKey: string;
                    cdnHostname: string;
                    region?: string;
                    storageZoneName: string;
                    tokenKey?: string;
                    type: "bunny";
                  }
                | { type: "test" };
            };
            path: string;
          },
          null | {
            attributes?: { expiresAt?: number };
            blobId: string;
            contentType: string;
            path: string;
            size: number;
          }
        >;
      };
      transact: {
        commitFiles: FunctionReference<
          "mutation",
          "internal",
          {
            config: {
              blobGracePeriod?: number;
              downloadUrlTtl?: number;
              storage:
                | {
                    apiKey: string;
                    cdnHostname: string;
                    region?: string;
                    storageZoneName: string;
                    tokenKey?: string;
                    type: "bunny";
                  }
                | { type: "test" };
            };
            files: Array<{
              attributes?: { expiresAt?: number };
              basis?: null | string;
              blobId: string;
              path: string;
            }>;
          },
          null
        >;
        transact: FunctionReference<
          "mutation",
          "internal",
          {
            config: {
              blobGracePeriod?: number;
              downloadUrlTtl?: number;
              storage:
                | {
                    apiKey: string;
                    cdnHostname: string;
                    region?: string;
                    storageZoneName: string;
                    tokenKey?: string;
                    type: "bunny";
                  }
                | { type: "test" };
            };
            ops: Array<
              | {
                  dest: { basis?: null | string; path: string };
                  op: "move";
                  source: {
                    attributes?: { expiresAt?: number };
                    blobId: string;
                    contentType: string;
                    path: string;
                    size: number;
                  };
                }
              | {
                  dest: { basis?: null | string; path: string };
                  op: "copy";
                  source: {
                    attributes?: { expiresAt?: number };
                    blobId: string;
                    contentType: string;
                    path: string;
                    size: number;
                  };
                }
              | {
                  op: "delete";
                  source: {
                    attributes?: { expiresAt?: number };
                    blobId: string;
                    contentType: string;
                    path: string;
                    size: number;
                  };
                }
              | {
                  attributes: { expiresAt?: null | number };
                  op: "setAttributes";
                  source: {
                    attributes?: { expiresAt?: number };
                    blobId: string;
                    contentType: string;
                    path: string;
                    size: number;
                  };
                }
            >;
          },
          null
        >;
      };
    };
    transfer: {
      getDownloadUrl: FunctionReference<
        "action",
        "internal",
        {
          blobId: string;
          config: {
            blobGracePeriod?: number;
            downloadUrlTtl?: number;
            storage:
              | {
                  apiKey: string;
                  cdnHostname: string;
                  region?: string;
                  storageZoneName: string;
                  tokenKey?: string;
                  type: "bunny";
                }
              | { type: "test" };
          };
          extraParams?: Record<string, string>;
        },
        string
      >;
      registerPendingUpload: FunctionReference<
        "mutation",
        "internal",
        {
          blobId: string;
          config: {
            blobGracePeriod?: number;
            downloadUrlTtl?: number;
            storage:
              | {
                  apiKey: string;
                  cdnHostname: string;
                  region?: string;
                  storageZoneName: string;
                  tokenKey?: string;
                  type: "bunny";
                }
              | { type: "test" };
          };
          contentType: string;
          size: number;
        },
        null
      >;
    };
  };
};
