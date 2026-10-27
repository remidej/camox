// Timing spans: how long revision builds, agent turns and publishes take, as one single-line JSON
// log per span, which Workers Logs and `wrangler tail` parse into fields. Every line has `timing`,
// the span's stable name, and `durationMs`. The IDs a span is given (`projectId`, the project's
// row id, `draftId`, `buildId`, `revisionId`, `threadId`, `runId`, `instanceId`) group the spans
// of one build, turn or publish. A Worker's clock only moves on I/O, which every span here does.

/** What a span's line says beside its name and duration. Undefined fields are left out. */
export type SpanFields = Record<string, string | number | boolean | null | undefined>;

/** Logs the span `name`, which took `durationMs`. */
export function logSpan(name: string, durationMs: number, fields: SpanFields = {}) {
  console.log(JSON.stringify({ timing: name, durationMs: Math.round(durationMs), ...fields }));
}

/** What a span's line says of an error that ended it: its message, kept short. */
export const errorField = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, 200);

/**
 * Runs `run`, logging how long it took as the span `name`, with `fields` and what `after` reads
 * of its result. A span that throws is logged with `ok: false` and the error, then rethrows.
 */
export async function timed<T>(
  name: string,
  fields: SpanFields,
  run: () => Promise<T>,
  after?: (result: T) => SpanFields,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await run();
    logSpan(name, Date.now() - startedAt, { ...fields, ...after?.(result), ok: true });
    return result;
  } catch (error) {
    logSpan(name, Date.now() - startedAt, { ...fields, ok: false, error: errorField(error) });
    throw error;
  }
}
