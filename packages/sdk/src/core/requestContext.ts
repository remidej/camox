declare const requestContextBrand: unique symbol;

/**
 * Opaque: pass it through unchanged. Camox gives it to `loader` and `routes` so that
 * collection helpers read the request's content.
 */
export interface LayoutRequestContext {
  readonly [requestContextBrand]: true;
}

interface RequestContextState {
  /** Draft for a valid editor session, otherwise live. */
  source: "live" | "draft";
}

const states = new WeakMap<LayoutRequestContext, RequestContextState>();

export function createRequestContext(state: RequestContextState): LayoutRequestContext {
  const context = Object.freeze({}) as LayoutRequestContext;
  states.set(context, state);
  return context;
}

export function getRequestSource(context: LayoutRequestContext): "live" | "draft" {
  const state = states.get(context);
  if (!state)
    throw new Error(
      "Camox request context is missing: pass the loader's context through unchanged",
    );
  return state.source;
}
