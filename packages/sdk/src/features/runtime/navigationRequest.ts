// Only the latest navigation may commit data, history or a document fallback.
// Fetch aborts are an optimization; the identity check also handles responses
// that finish just before abort (or transports that ignore AbortSignal).
export function createNavigationRequestTracker() {
  let current: AbortController | undefined;
  return {
    begin() {
      current?.abort();
      const controller = new AbortController();
      current = controller;
      return {
        signal: controller.signal,
        isCurrent: () => current === controller && !controller.signal.aborted,
      };
    },
    cancel() {
      current?.abort();
    },
  };
}
