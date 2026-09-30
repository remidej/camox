import type { ReferenceRecord } from "../lib/reference";

type SavedRecord = { id: string; version: number; draft: Record<string, unknown> };
type Write = (input: {
  id: string;
  collectionId: string;
  expectedVersion: number;
  content: Record<string, unknown>;
}) => Promise<SavedRecord>;

/**
 * One queue per source and client. Two occurrences editing a shared record must
 * not race each other or replace fields from a stale full-content snapshot.
 * Only our own successful save advances the reviewed version while queued.
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
    if (record.version == null) return Promise.reject(new Error("This record is not editable"));
    const key = `${record.collectionId}/${record.id}`;
    let source = this.sources.get(key);
    if (!source || (!source.pending && record.version > (source.record.version ?? 0))) {
      source = { record };
      this.sources.set(key, source);
    }
    const state = source;
    const operation = (state.pending ?? Promise.resolve()).then(async () => {
      const saved = await write({
        id: record.id,
        collectionId: record.collectionId,
        expectedVersion: state.record.version!,
        content: { ...state.record.content, [field]: value },
      });
      state.record = { ...state.record, content: saved.draft, version: saved.version };
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

const writers = new WeakMap<object, ReferenceWrites>();
export function referenceWritesFor(client: object) {
  let writer = writers.get(client);
  if (!writer) {
    writer = new ReferenceWrites();
    writers.set(client, writer);
  }
  return writer;
}
