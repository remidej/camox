import { and, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import { journaled } from "../../lib/journal";
import { runService as run } from "../../lib/run-service";
import { blocks, drafts, locales, pages } from "../../schema";
import { accessTo } from "./access";
import * as overlay from "./overlay";
import { inLocale, RELEASE, type Draft, type ReadScope } from "./scope";

// Content is identified by its id and its locale (ADR 0015): the overlay matches on both.

async function fixture(suffix: string) {
  const base = await createProjectFixture(suffix);
  const { db, project, memberUser } = base;
  const openDraft = async (): Promise<Draft> => {
    const draft = await db
      .insert(drafts)
      .values({
        projectId: project.id,
        kind: "regular",
        createdBy: memberUser.id,
        createdAt: Date.now(),
      })
      .returning()
      .get();
    return { id: draft.id, kind: draft.kind, projectId: draft.projectId };
  };
  const publish = (draft: Draft, shown: overlay.ConflictKey[] = [], now = Date.now()) =>
    run(overlay.publish(db, draft, { shown, publishedBy: memberUser.id, now }).pipe(Effect.orDie));
  const pageValues = {
    projectId: project.id,
    layoutId: base.layout.layoutId,
    pathSegment: "",
    fullPath: "/",
    nickname: "Home",
    contentUpdatedAt: 1,
    createdAt: 1,
    updatedAt: 1,
  };
  const page = (await run(overlay.insert(db, RELEASE, pages, pageValues)))!;
  // German is on Live: content in a locale needs the locale.
  const localeValues = { projectId: project.id, tag: "de", createdAt: 1, updatedAt: 1 };
  await run(overlay.insert(db, RELEASE, locales, localeValues));
  const newBlock = (title: string, id?: string) => ({
    id,
    projectId: project.id,
    pageId: page.id,
    type: "hero",
    content: { title },
    position: "a0",
    createdAt: 1,
    updatedAt: 1,
  });
  /** A block on Live in the default locale, and its German localization, sharing its id. */
  const localizedBlock = async () => {
    const english = (await run(overlay.insert(db, RELEASE, blocks, newBlock("Hello"))))!;
    const draft = await openDraft();
    const german = inLocale(draft, "de");
    await run(overlay.insert(db, german, pages, { ...pageValues, id: page.id }));
    await run(overlay.insert(db, german, blocks, newBlock("Hallo", english.id)));
    await publish(draft);
    return english.id;
  };
  const titleIn = async (scope: ReadScope, id: string) =>
    ((await run(overlay.get(db, scope, blocks, id)))?.content as { title?: string } | undefined)
      ?.title;
  return { ...base, openDraft, publish, page, newBlock, localizedBlock, titleIn };
}

describe("content keyed by locale", () => {
  it("reads and writes the same id in each locale apart", async () => {
    const { db, openDraft, newBlock, titleIn } = await fixture("locales-read-write");
    const english = (await run(overlay.insert(db, RELEASE, blocks, newBlock("Hello"))))!;
    const draft = await openDraft();
    const german = inLocale(draft, "de");

    // A localization keeps its original's id.
    const created = await run(overlay.insert(db, german, blocks, newBlock("Hallo", english.id)));
    expect(created).toMatchObject({ id: english.id, locale: "de" });

    await run(overlay.update(db, draft, blocks, english.id, { content: { title: "Hi" } }));
    await run(overlay.update(db, german, blocks, english.id, { content: { title: "Servus" } }));

    expect(await titleIn(draft, english.id)).toBe("Hi");
    expect(await titleIn(german, english.id)).toBe("Servus");
    expect(await titleIn(null, english.id)).toBe("Hello");
    expect(await titleIn(inLocale(null, "de"), english.id)).toBeUndefined();
  });

  it("lists a change per locale an entity changed in", async () => {
    const { db, openDraft, localizedBlock } = await fixture("locales-changes");
    const id = await localizedBlock();
    const draft = await openDraft();

    await run(overlay.update(db, draft, blocks, id, { content: { title: "Hi" } }));
    await run(overlay.remove(db, inLocale(draft, "de"), blocks, id));

    const changes = await run(overlay.changesOf(db, draft));
    expect(changes.map(({ row, change }) => ({ id: row.id, locale: row.locale, change }))).toEqual(
      expect.arrayContaining([
        { id, locale: "en", change: "changed" },
        { id, locale: "de", change: "deleted" },
      ]),
    );
    expect(changes).toHaveLength(2);
  });

  it("publishes each locale's changes onto its own Live entity", async () => {
    const { db, openDraft, publish, localizedBlock, titleIn } = await fixture("locales-publish");
    const id = await localizedBlock();
    const draft = await openDraft();

    await run(overlay.update(db, draft, blocks, id, { content: { title: "Hi" } }));
    await run(
      overlay.update(db, inLocale(draft, "de"), blocks, id, { content: { title: "Servus" } }),
    );
    await publish(draft);

    expect(await titleIn(null, id)).toBe("Hi");
    expect(await titleIn(inLocale(null, "de"), id)).toBe("Servus");
  });

  it("tells readers the blocks changed of the page in the published block's locale only", async () => {
    const { db, openDraft, publish, page, localizedBlock } = await fixture("locales-bumps");
    const id = await localizedBlock();
    const updatedAt = async (locale: string | null) =>
      (await run(overlay.get(db, locale ? inLocale(null, locale) : null, pages, page.id)))!
        .contentUpdatedAt;
    const before = { en: await updatedAt(null), de: await updatedAt("de") };
    const draft = await openDraft();

    await run(
      overlay.update(db, inLocale(draft, "de"), blocks, id, { content: { title: "Servus" } }),
    );
    await publish(draft, [], Math.max(before.en, before.de) + 1000);

    expect(await updatedAt("de")).toBeGreaterThan(before.de);
    expect(await updatedAt(null)).toBe(before.en);
  });

  it("deletes only the locale a draft deleted an entity in when publishing", async () => {
    const { db, openDraft, publish, localizedBlock, titleIn } = await fixture("locales-delete");
    const id = await localizedBlock();
    const draft = await openDraft();

    await run(overlay.remove(db, inLocale(draft, "de"), blocks, id));
    await publish(draft);

    expect(await titleIn(null, id)).toBe("Hello");
    expect(await titleIn(inLocale(null, "de"), id)).toBeUndefined();
  });

  it("discards a draft's changes in every locale", async () => {
    const { db, openDraft, localizedBlock, titleIn, memberUser } = await fixture("locales-discard");
    const id = await localizedBlock();
    const draft = await openDraft();
    await run(overlay.update(db, draft, blocks, id, { content: { title: "Hi" } }));
    await run(
      overlay.update(db, inLocale(draft, "de"), blocks, id, { content: { title: "Servus" } }),
    );

    await run(
      overlay
        .discard(db, draft, { discardedBy: memberUser.id, now: Date.now() })
        .pipe(Effect.orDie),
    );

    expect(await titleIn(null, id)).toBe("Hello");
    expect(await titleIn(inLocale(null, "de"), id)).toBe("Hallo");
    expect(await db.select().from(blocks).where(eq(blocks.draftId, draft.id))).toHaveLength(0);
  });

  it("finds a conflict only in the locale Live changed since the draft copied it", async () => {
    const { db, openDraft, publish, localizedBlock, titleIn } = await fixture("locales-conflicts");
    const id = await localizedBlock();
    const draft = await openDraft();
    await run(
      overlay.update(db, inLocale(draft, "de"), blocks, id, { content: { title: "Servus" } }),
    );

    // A release changes the default locale's block, which the draft didn't copy.
    await run(overlay.update(db, RELEASE, blocks, id, { content: { title: "Hello again" } }));
    expect(await run(overlay.conflictsOf(db, draft))).toEqual([]);

    // Another draft publishes a change to the German block the draft copied.
    const other = await openDraft();
    await run(
      overlay.update(db, inLocale(other, "de"), blocks, id, { content: { title: "Moin" } }),
    );
    await publish(other);
    const conflicts = await run(overlay.conflictsOf(db, draft));
    expect(conflicts).toEqual([expect.objectContaining({ entity: "block", id, locale: "de" })]);

    // Publishing knowingly overwrites the German block only.
    await publish(draft, [["block", id, conflicts[0]!.liveVersion, "de"]]);
    expect(await titleIn(inLocale(null, "de"), id)).toBe("Servus");
    expect(await titleIn(null, id)).toBe("Hello again");
  });

  it("refuses to publish over a conflict shown in another locale", async () => {
    const { db, openDraft, publish, localizedBlock } = await fixture("locales-guard");
    const id = await localizedBlock();
    const draft = await openDraft();
    await run(
      overlay.update(db, inLocale(draft, "de"), blocks, id, { content: { title: "Servus" } }),
    );
    const other = await openDraft();
    await run(
      overlay.update(db, inLocale(other, "de"), blocks, id, { content: { title: "Moin" } }),
    );
    await publish(other);
    const [conflict] = await run(overlay.conflictsOf(db, draft));

    await expect(publish(draft, [["block", id, conflict!.liveVersion, "en"]])).rejects.toThrow();
  });

  it("loses a change whose parent is missing from its locale", async () => {
    const { db, openDraft, newBlock, page } = await fixture("locales-lost");
    const draft = await openDraft();
    const german = inLocale(draft, "de");
    // The page exists in the default locale only.
    const orphan = (await run(overlay.insert(db, german, blocks, newBlock("Hallo"))))!;
    const kept = (await run(overlay.insert(db, draft, blocks, newBlock("Hello"))))!;

    const lost = await run(overlay.lostOf(db, draft));

    expect(lost).toEqual([{ reason: "parentGone", entity: "block", id: orphan.id, locale: "de" }]);
    expect(lost.some((loss) => loss.id === kept.id)).toBe(false);
    expect(page.locale).toBe("en");
  });

  it("counts only Live descendants in a deleted entity's locale as added after its deletion", async () => {
    const { db, openDraft, publish, page, newBlock, localizedBlock } = await fixture(
      "locales-added-after-deletion",
    );
    await localizedBlock();
    const draft = await openDraft();
    await run(overlay.remove(db, inLocale(draft, "de"), pages, page.id));

    const english = await openDraft();
    await run(overlay.insert(db, english, blocks, newBlock("Welcome")));
    await publish(english);
    expect(await run(overlay.conflictsOf(db, draft))).toEqual([]);
    expect(await run(overlay.lostOf(db, draft))).toEqual([]);

    const german = await openDraft();
    const added = (await run(
      overlay.insert(db, inLocale(german, "de"), blocks, newBlock("Willkommen")),
    ))!;
    await publish(german);
    expect(await run(overlay.lostOf(db, draft))).toEqual([
      {
        reason: "writtenAfterDeletion",
        entity: "block",
        id: added.id,
        locale: "de",
        parent: { entity: "page", id: page.id, locale: "de" },
      },
    ]);
  });

  it("deletes a Live entity's descendants in the locale its deletion was published in", async () => {
    const { db, openDraft, publish, page, localizedBlock, titleIn } =
      await fixture("locales-descendants");
    const id = await localizedBlock();
    const draft = await openDraft();

    await run(overlay.remove(db, inLocale(draft, "de"), pages, page.id));
    await publish(draft);

    expect(await titleIn(inLocale(null, "de"), id)).toBeUndefined();
    expect(await titleIn(null, id)).toBe("Hello");
  });

  it("gives a request naming an entity its localization in the default locale", async () => {
    const { db, project, localizedBlock } = await fixture("locales-access");
    const id = await localizedBlock();
    const titleOfRequested = async () => {
      const access = await Effect.runPromise(
        journaled(
          Effect.scoped(accessTo(createServiceContext(db, null), { block: id }, "public")),
          () => Effect.void,
        ),
      );
      return (access.entity.block.content as { title: string }).title;
    };
    expect(await titleOfRequested()).toBe("Hello");

    // German becomes the default locale.
    await db.update(locales).set({ isDefault: false }).where(eq(locales.projectId, project.id));
    await db
      .update(locales)
      .set({ isDefault: true })
      .where(and(eq(locales.projectId, project.id), eq(locales.tag, "de")));
    expect(await titleOfRequested()).toBe("Hallo");
  });

  it("reads and writes in the project's default locale when a scope names none", async () => {
    const { db, project, openDraft, newBlock, titleIn } = await fixture("locales-default");
    await db
      .update(locales)
      .set({ tag: "fr" })
      .where(
        and(
          eq(locales.projectId, project.id),
          isNull(locales.draftId),
          eq(locales.isDefault, true),
        ),
      );

    const live = (await run(overlay.insert(db, RELEASE, blocks, newBlock("Bonjour"))))!;
    const draft = await openDraft();
    const drafted = (await run(overlay.insert(db, draft, blocks, newBlock("Salut"))))!;

    expect(live.locale).toBe("fr");
    expect(drafted.locale).toBe("fr");
    expect(await titleIn(null, live.id)).toBe("Bonjour");
    expect(await titleIn(draft, drafted.id)).toBe("Salut");
    expect(await titleIn(inLocale(null, "en"), live.id)).toBeUndefined();
  });
});
