import { customAction, customMutation, customQuery } from "convex-helpers/server/customFunctions";

/* eslint-disable no-restricted-imports */
import {
  mutation as rawMutation,
  query as rawQuery,
  internalMutation as rawInternalMutation,
  internalAction as rawInternalAction,
} from "./_generated/server";

async function ensureAuthenticated(ctx: { auth: { getUserIdentity: () => Promise<any> } }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Not authenticated");
  }
  return identity;
}

export const mutation = customMutation(rawMutation, {
  args: {},
  input: async (ctx) => {
    await ensureAuthenticated(ctx);
    return { ctx: {}, args: {} };
  },
});

export const query = customQuery(rawQuery, {
  args: {},
  input: async (ctx) => {
    await ensureAuthenticated(ctx);
    return { ctx: {}, args: {} };
  },
});

export const internalMutation = customMutation(rawInternalMutation, {
  args: {},
  input: async (_ctx) => {
    return { ctx: {}, args: {} };
  },
});

export const internalAction = customAction(rawInternalAction, {
  args: {},
  input: async (_ctx) => {
    return { ctx: {}, args: {} };
  },
});
