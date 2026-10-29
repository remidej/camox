import { Effect } from "effect";

import type { Database } from "../../db";
import { camoxContext } from "../drafts/camox-context";
import { missingPageLinks } from "../drafts/content-checks";
import type { Draft } from "../drafts/scope";
import type { RaisedFinding } from "./findings";
import type { Checker } from "./patrollers";

// The Link checker's check of a draft (ADR 0034): links to pages the draft is missing, in what it
// changed, each with "Remove the link" as its fix. Its identity is the link's url, project-wide.

export const checkLinks: Checker = (db: Database, draft: Draft) =>
  Effect.map(missingPageLinks(camoxContext(db), draft), (missing) => ({
    checked: "everything" as const,
    found: missing.map(({ holder, locale, field, link, page }): RaisedFinding => ({
      entity: holder.entity,
      id: holder.id,
      locale,
      field: field.name,
      identity: link.url,
      about: { kind: "missingPage", url: link.url, text: link.text, page },
      fix: { kind: "removeLink" },
    })),
  }));
