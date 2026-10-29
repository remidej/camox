import { createModels } from "@earendil-works/pi-ai/models";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";

/** Tokens a call used, as an AI usage record counts them. */
export type CallTokens = {
  /** Input tokens neither read from nor written to the cache. */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

/** The price list: pi-ai's catalog of OpenRouter's models, in US dollars per million tokens. */
const catalog = createModels();
catalog.setProvider(openrouterProvider());

/**
 * What a call of an OpenRouter model would cost by the price list, in millionths of a US dollar,
 * or null for a model the list doesn't know. Used when OpenRouter reports no cost.
 */
export const estimatedCostMicroUsd = (model: string, tokens: CallTokens) => {
  const price = catalog.getModel("openrouter", model)?.cost;
  if (!price) return null;
  // A price per million tokens is a price in millionths of a dollar per token.
  return Math.round(
    tokens.input * price.input +
      tokens.output * price.output +
      tokens.cacheRead * price.cacheRead +
      tokens.cacheWrite * price.cacheWrite,
  );
};
