import { ORPCError } from "@orpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getAuthorizedProjectBySlug } from "../../authorization";
import { lexicalStateToPlainText } from "../../lib/lexical-state";
import { stableStringify } from "../../lib/stable-stringify";
import { blockDefinitions, layouts, pages, projects } from "../../schema";
import type { ServiceContext } from "../_shared/service-context";
import { collectionDefinitions, collectionRecords, collectionRevisions } from "./schema";

type Field = Record<string, unknown>;
export type ResolvedReference = {
  id: string;
  collectionId: string;
  label: string;
  content: Record<string, unknown>;
  contentSchema: unknown;
  version?: number;
  revisionId?: string;
};

export function referenceFields(schema: unknown): [string, Field][] {
  const properties = (schema as { properties?: Record<string, Field> } | null)?.properties;
  return Object.entries(properties ?? {}).filter(([, field]) => field.fieldType === "Reference");
}

/** Only direct single references are supported; fail closed for future shapes. */
export function validateReferenceSchema(schema: unknown, allow = true): void {
  const allowed = new Set(referenceFields(schema).map(([, field]) => field));
  function visit(value: unknown) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    const field = value as Field;
    const kind = field.kind ?? field.fieldType;
    if (kind === "ReferenceList" || kind === "Reference") {
      if (!allow || field.fieldType !== "Reference" || !allowed.has(field)) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Only top-level single block references are supported",
        });
      }
      if (typeof field.collectionId !== "string" || !field.collectionId) {
        throw new ORPCError("BAD_REQUEST", { message: "Reference requires collectionId" });
      }
    }
    for (const child of Object.values(field)) visit(child);
  }
  visit(schema);
}

export async function resolveReferences(
  ctx: ServiceContext,
  scope: { projectId: number; environmentId: number },
  schema: unknown,
  content: unknown,
  source: "draft" | "live",
): Promise<Record<string, ResolvedReference | null>> {
  const fields = referenceFields(schema);
  if (!fields.length) return {};
  if (source === "draft") {
    if (!ctx.user) throw new ORPCError("UNAUTHORIZED");
    const project = await ctx.db
      .select()
      .from(projects)
      .where(eq(projects.id, scope.projectId))
      .get();
    if (!project || !(await getAuthorizedProjectBySlug(ctx.db, project.slug, ctx.user.id))) {
      throw new ORPCError("NOT_FOUND");
    }
  }
  const result: Record<string, ResolvedReference | null> = {};
  for (const [name, field] of fields) {
    result[name] = null;
    const id = (content as Record<string, unknown> | null)?.[name];
    if (!z.uuid().safeParse(id).success) continue;
    const definition = await ctx.db
      .select()
      .from(collectionDefinitions)
      .where(
        and(
          eq(collectionDefinitions.projectId, scope.projectId),
          eq(collectionDefinitions.environmentId, scope.environmentId),
          eq(collectionDefinitions.collectionId, String(field.collectionId)),
          eq(collectionDefinitions.active, true),
        ),
      )
      .get();
    if (!definition) continue;
    const record = await ctx.db
      .select()
      .from(collectionRecords)
      .where(
        and(
          eq(collectionRecords.id, id as string),
          eq(collectionRecords.definitionId, definition.id),
        ),
      )
      .get();
    if (!record) continue;
    if (source === "draft") {
      result[name] = {
        id: record.id,
        collectionId: definition.collectionId,
        content: record.draft,
        label: lexicalStateToPlainText(record.draft[definition.label] as string),
        contentSchema: definition.contentSchema,
        version: record.version,
      };
      continue;
    }
    if (!record.publishedRevisionId) continue;
    const revision = await ctx.db
      .select()
      .from(collectionRevisions)
      .where(
        and(
          eq(collectionRevisions.id, record.publishedRevisionId),
          eq(collectionRevisions.recordId, record.id),
        ),
      )
      .get();
    if (!revision) continue;
    result[name] = {
      id: record.id,
      collectionId: definition.collectionId,
      content: revision.content,
      label: lexicalStateToPlainText(revision.content[String(revision.definition.label)] as string),
      contentSchema: (revision.definition as { contentSchema: unknown }).contentSchema,
      revisionId: revision.id,
    };
  }
  return result;
}

export async function hydrateReferences<T extends { type: string; content: unknown }>(
  ctx: ServiceContext,
  scope: { projectId: number; environmentId: number },
  values: T[],
  source: "draft" | "live",
) {
  const definitions = await ctx.db
    .select()
    .from(blockDefinitions)
    .where(
      and(
        eq(blockDefinitions.projectId, scope.projectId),
        eq(blockDefinitions.environmentId, scope.environmentId),
      ),
    );
  return Promise.all(
    values.map(async (block) => ({
      ...block,
      references: await resolveReferences(
        ctx,
        scope,
        definitions.find((definition) => definition.blockId === block.type)?.contentSchema,
        block.content,
        source,
      ),
    })),
  );
}

export async function validateReferenceValues(
  ctx: ServiceContext,
  scope: { projectId: number; environmentId: number },
  schema: unknown,
  content: unknown,
) {
  for (const [name, field] of referenceFields(schema)) {
    const value = (content as Record<string, unknown> | null)?.[name];
    if (value === undefined || value === null) continue;
    const validId = z.uuid().safeParse(value);
    const record = validId.success
      ? await ctx.db
          .select({ id: collectionRecords.id })
          .from(collectionRecords)
          .innerJoin(
            collectionDefinitions,
            eq(collectionDefinitions.id, collectionRecords.definitionId),
          )
          .where(
            and(
              eq(collectionRecords.id, validId.data),
              eq(collectionDefinitions.projectId, scope.projectId),
              eq(collectionDefinitions.environmentId, scope.environmentId),
              eq(collectionDefinitions.collectionId, String(field.collectionId)),
              eq(collectionDefinitions.active, true),
            ),
          )
          .get()
      : null;
    if (!record)
      throw new ORPCError("BAD_REQUEST", {
        message: `${name}: reference is missing or outside this collection/site/environment`,
      });
  }
}

export async function blockScope(
  ctx: ServiceContext,
  block: { pageId: number | null; layoutId: number | null },
) {
  const owner =
    block.pageId !== null
      ? await ctx.db.select().from(pages).where(eq(pages.id, block.pageId)).get()
      : block.layoutId !== null
        ? await ctx.db.select().from(layouts).where(eq(layouts.id, block.layoutId)).get()
        : null;
  if (!owner) throw new ORPCError("NOT_FOUND");
  return { projectId: owner.projectId, environmentId: owner.environmentId };
}

/** Derived dependency status; source edits never mutate page/layout checkpoints. */
export async function referenceChanges(ctx: ServiceContext, environmentId: number) {
  const rows = await ctx.db.all<{
    page_id: number | null;
    layout_id: number | null;
    draft: string;
    content: string | null;
  }>(sql`select u.page_id, u.layout_id, r.draft, v.content
    from collection_reference_uses u join collection_records r
      on r.id = u.record_id and r.definition_id = u.definition_id
    left join collection_revisions v on v.id = r.published_revision_id
    where u.environment_id = ${environmentId} and u.live = 0`);
  const pageIds = new Set<number>();
  const layoutIds = new Set<number>();
  for (const row of rows) {
    if (
      row.content &&
      stableStringify(JSON.parse(row.draft)) === stableStringify(JSON.parse(row.content))
    )
      continue;
    if (row.page_id !== null) pageIds.add(row.page_id);
    if (row.layout_id !== null) layoutIds.add(row.layout_id);
  }
  return { pageIds, layoutIds };
}
