// Which user Worker serves a project's website: the one named after its Project ID, which its
// releases deploy, unless a publish with code put its own there. The API keeps that pointer
// (apps/api/src/domains/publishes/scripts.ts), and dispatch asks it over its `API` service
// binding, keeping each answer in the isolate for `LIVE_SCRIPT_TTL_MS`.

/**
 * How long an answer is kept, per project. Mirrored in apps/api/src/domains/publishes/scripts.ts
 * (`LIVE_SCRIPT_SETTLES`), which waits that long, and a second, before a publish's content goes
 * on Live: keep the two in sync.
 */
export const LIVE_SCRIPT_TTL_MS = 2_000;

/** What dispatch asks the API's `CamoxPreviews` entrypoint about a project's website. */
export interface LiveScriptApi {
  /**
   * The user Worker serving the website of the project `project` (its Project ID): a publish's,
   * or null for the one named after its Project ID.
   */
  liveScript(question: { project: string }): Promise<string | null>;
}

type Answer = { at: number; script: Promise<string | null>; settled?: string | null };

/** The API's recent answers in this isolate, by its binding, then project. */
const answersOf = new WeakMap<LiveScriptApi, Map<string, Answer>>();

/**
 * The name of the user Worker that serves `project`'s website. An answer older than
 * `LIVE_SCRIPT_TTL_MS` is asked again. While the API can't answer, the last answer it gave
 * stands, else the Worker named after the Project ID serves.
 */
export async function liveScriptFor(api: LiveScriptApi, project: string): Promise<string> {
  const answers = answersOf.get(api) ?? new Map<string, Answer>();
  answersOf.set(api, answers);
  const now = Date.now();
  let answer = answers.get(project);
  const last = answer;
  if (!answer || now - answer.at > LIVE_SCRIPT_TTL_MS) {
    // An async wrapper (not `Promise.try`, missing from Node 22) so a synchronous throw rejects too.
    const asked: Answer = { at: now, script: (async () => api.liveScript({ project }))() };
    asked.script.then(
      (script) => {
        asked.settled = script;
      },
      () => {
        // A failed answer isn't kept: the next request asks again, and the last answer stands.
        if (answers.get(project) === asked) {
          if (last) answers.set(project, last);
          else answers.delete(project);
        }
      },
    );
    answers.set(project, asked);
    answer = asked;
  }
  try {
    return (await answer.script) ?? project;
  } catch (error) {
    console.error("The API couldn't say which Worker serves a website", error);
    return last?.settled ?? project;
  }
}
