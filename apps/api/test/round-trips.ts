import { env } from "cloudflare:workers";

import { createDb } from "../src/db";
import { forwarded } from "./forwarded";

/** How long a round stays open for the statements issued alongside its first. */
const ROUND_MS = 15;

/**
 * A D1 binding that counts what reads cost: the statements prepared, and the round trips they
 * take. Statements issued together, before any of them answers, share a round trip, like
 * concurrent reads or a batch do on D1; a statement issued after another answered starts a new
 * one. Each round holds its answers until it closes, so a read that waits on another always
 * lands in a later round, however fast the local database answers.
 */
export function roundTripDb() {
  let statements: string[] = [];
  let rounds: string[][] = [];
  let open: { queries: string[]; done: Promise<void> } | undefined;

  /** The round a statement issued now joins: the open one, or a new one. */
  const join = (query: string) => {
    if (!open) {
      const round = { queries: [] as string[], done: undefined as unknown as Promise<void> };
      round.done = new Promise((resolve) =>
        setTimeout(() => {
          open = undefined;
          resolve();
        }, ROUND_MS),
      );
      open = round;
      rounds.push(round.queries);
    }
    open.queries.push(query);
    return open.done;
  };
  const held = async <T>(query: string, run: () => Promise<T>): Promise<T> => {
    const done = join(query);
    const settled = await Promise.allSettled([run()]);
    await done;
    const [result] = settled;
    if (result!.status === "rejected") throw result!.reason;
    return result!.value;
  };

  const real = new WeakMap<object, D1PreparedStatement>();
  const wrap = (query: string, statement: D1PreparedStatement): D1PreparedStatement => {
    const wrapped = new Proxy(statement, {
      get(target, property) {
        if (property === "bind") {
          return (...values: unknown[]) => wrap(query, target.bind(...values));
        }
        if (
          property === "all" ||
          property === "raw" ||
          property === "first" ||
          property === "run"
        ) {
          return (...args: unknown[]) =>
            held(query, () =>
              (target[property] as (...args: unknown[]) => Promise<unknown>).apply(target, args),
            );
        }
        return forwarded(target, property);
      },
    });
    real.set(wrapped, statement);
    return wrapped;
  };

  const d1 = new Proxy(env.DB, {
    get(target, property) {
      if (property === "prepare") {
        return (query: string) => {
          statements.push(query);
          return wrap(query, target.prepare(query));
        };
      }
      if (property === "batch") {
        return (batched: D1PreparedStatement[]) =>
          held(`batch of ${batched.length}`, () =>
            target.batch(batched.map((statement) => real.get(statement) ?? statement)),
          );
      }
      return forwarded(target, property);
    },
  });

  return {
    db: createDb(d1),
    /** Forgets what was counted so far. */
    reset: () => {
      statements = [];
      rounds = [];
    },
    /** The statements prepared since the last reset. */
    statements: () => statements.length,
    /** The round trips taken since the last reset: the reads that waited on one another. */
    roundTrips: () => rounds.length,
    /** Each round trip's statements, for a failing test to show. */
    rounds: () => rounds.map((round) => [...round]),
  };
}
