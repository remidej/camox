import type { QueryClient } from "@tanstack/react-query";

import type { ReferenceRecord } from "../lib/reference";

type SavedRecord = { id: string; content: Record<string, unknown> };
type Write = (input: {
  id: string;
  collectionId: string;
  content: Record<string, unknown>;
}) => Promise<SavedRecord>;

/**
 * One queue per record and client. Two placements editing a shared record must
 * not race each other or replace fields from a stale full-content snapshot:
 * while saves are queued, each builds on the content the previous one saved.
 */
export class ReferenceWrites {
  private sources = new Map<
    string,
    {
      record: ReferenceRecord;
      pending?: Promise<void>;
    }
  >();

  save(record: ReferenceRecord, field: string, value: unknown, write: Write): Promise<void> {
    const key = `${record.collectionId}/${record.id}`;
    let source = this.sources.get(key);
    if (!source?.pending) {
      source = { record };
      this.sources.set(key, source);
    }
    const state = source;
    const operation = (state.pending ?? Promise.resolve()).then(async () => {
      const saved = await write({
        id: record.id,
        collectionId: record.collectionId,
        content: { ...state.record.content, [field]: value },
      });
      state.record = { ...state.record, content: saved.content };
    });
    state.pending = operation;
    void operation.then(
      () => {
        if (state.pending === operation) state.pending = undefined;
      },
      () => {
        if (state.pending === operation) state.pending = undefined;
      },
    );
    return operation;
  }
}

const writers = new WeakMap<QueryClient, ReferenceWrites>();
export function referenceWritesFor(client: QueryClient) {
  let writer = writers.get(client);
  if (!writer) {
    writer = new ReferenceWrites();
    writers.set(client, writer);
  }
  return writer;
}
