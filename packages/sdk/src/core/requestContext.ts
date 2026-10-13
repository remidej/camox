import type { ReferenceRecord } from "./lib/reference";

declare const requestContextBrand: unique symbol;

/**
 * Opaque: pass it through unchanged. Camox gives it to `loader` and `routes` so that
 * collection helpers read the request's content.
 */
export interface LayoutRequestContext {
  readonly [requestContextBrand]: true;
}

/** Names one collection record, whatever its content. */
export interface CollectionRecordId {
  collectionId: string;
  id: string;
}

/** A collection record as a record page loads it. */
export interface LoadedRecord<Content = Record<string, unknown>> {
  id: string;
  content: Content;
  /** The records it links, resolved by Camox with the record as the first hop. */
  references?: ReferenceRecord["references"];
  /** The draft's version, which edits on the record page send as expected. Live has none. */
  version?: number;
}

/** Reads records in the request's source, scoped to the project and environment. */
export interface RecordLookup {
  /** The records whose String field's plain text equals `value`. */
  findByField(input: {
    collectionId: string;
    field: string;
    value: string;
  }): Promise<LoadedRecord[]>;
  /**
   * Every record whose String field's plain text can be a path segment, with that text.
   * Records sharing a value are all listed.
   */
  listPageValues(input: {
    collectionId: string;
    field: string;
  }): Promise<Array<{ id: string; value: string }>>;
}

interface RequestContextState {
  /**
   * Reads drafts for a valid editor session, otherwise live content. Absent when the runtime
   * has no API to read records from.
   */
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

export function getRecordLookup(context: LayoutRequestContext): RecordLookup {
  const { records } = getState(context);
  if (!records) throw new Error("Camox can't read collection records: its API is not configured");
  return records;
}
