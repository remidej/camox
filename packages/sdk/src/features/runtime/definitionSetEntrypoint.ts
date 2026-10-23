/**
 * The name of the server build's entrypoint that returns the website's Definition Set, for the
 * Worker that loads a revision: `worker.getEntrypoint(DEFINITION_SET_ENTRYPOINT).read()`. It is a
 * `WorkerEntrypoint`, so no HTTP request reaches it.
 */
export const DEFINITION_SET_ENTRYPOINT = "CamoxDefinitionSet";
