/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as blockDefinitions from "../blockDefinitions.js";
import type * as blocks from "../blocks.js";
import type * as functions from "../functions.js";
import type * as pageActions from "../pageActions.js";
import type * as pages from "../pages.js";
import type * as projects from "../projects.js";
import type * as repeatableItems from "../repeatableItems.js";
import type * as seed from "../seed.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  blockDefinitions: typeof blockDefinitions;
  blocks: typeof blocks;
  functions: typeof functions;
  pageActions: typeof pageActions;
  pages: typeof pages;
  projects: typeof projects;
  repeatableItems: typeof repeatableItems;
  seed: typeof seed;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
