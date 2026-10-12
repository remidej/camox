declare const requestContextBrand: unique symbol;

/**
 * Opaque: pass it through unchanged. Camox gives it to `loader` and `routes` so that
 * collection helpers read the request's content.
 */
export interface LayoutRequestContext {
  readonly [requestContextBrand]: true;
}

/** A collection record as a record page loads it. */
export interface LoadedRecord {
  id: string;
  content: Record<string, unknown>;
}

/** Reads records in the request's source, scoped to the project and environment. */
export interface RecordLookup {
  /** The records whose String field's plain text equals `value`. */
  findByField(input: {
    collectionId: string;
    field: string;
    value: string;
  }): Promise<LoadedRecord[]>;
}

interface RequestContextState {
  /** Draft for a valid editor session, otherwise live. */
  source: "live" | "draft";
  /** Absent when the runtime has no API to read records from. */
  records?: RecordLookup;
}

const states = new WeakMap<LayoutRequestContext, RequestContextState>();

export function createRequestContext(state: RequestContextState): LayoutRequestContext {
  const context = Object.freeze({}) as LayoutRequestContext;
  states.set(context, state);
  return context;
}

function getState(context: LayoutRequestContext) {
  const state = states.get(context);
  if (!state)
    throw new Error(
      "Camox request context is missing: pass the loader's context through unchanged",
    );
  return state;
}

export function getRequestSource(context: LayoutRequestContext): "live" | "draft" {
  return getState(context).source;
}

export function getRecordLookup(context: LayoutRequestContext): RecordLookup {
  const { records } = getState(context);
  if (!records) throw new Error("Camox can't read collection records: its API is not configured");
  return records;
}
