/**
 * Runs `run`, yielding each step it reports through `progress` as it goes, then what it returns:
 * a long request streams, so the client hears it's alive. A failure of `run` is thrown once the
 * steps before it were yielded.
 */
export async function* streamProgress<S, R>(
  run: (progress: (step: S) => void) => Promise<R>,
): AsyncGenerator<{ type: "progress"; step: S } | { type: "done"; value: R }> {
  const steps: S[] = [];
  let wake: (() => void) | undefined;
  const progress = (step: S) => {
    steps.push(step);
    wake?.();
  };
  let outcome: { value: R } | { error: unknown } | undefined;
  const running = run(progress).then(
    (value) => {
      outcome = { value };
      wake?.();
    },
    (error: unknown) => {
      outcome = { error };
      wake?.();
    },
  );
  while (true) {
    while (steps.length > 0) yield { type: "progress", step: steps.shift()! };
    if (outcome) break;
    await new Promise<void>((resolve) => (wake = resolve));
    wake = undefined;
  }
  await running;
  if ("error" in outcome) throw outcome.error;
  yield { type: "done", value: outcome.value };
}
