import { projectIdSchema } from "@camox/api-contract/ids";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { projects } from "./schema";

/**
 * A project as a website's code, the studio or the CLI names it: by its Project ID, or by its
 * Project Slug, which older SDKs still send. The slug is accepted only as a bridge until every
 * project serves an SDK naming it by Project ID (ADR 0019).
 */
export type ProjectRef = { projectUuid: string } | { projectSlug: string };

/** The names of a project an input holds, once checked to be exactly one. */
type OneProjectName =
  | { projectUuid: string; projectSlug?: undefined }
  | { projectUuid?: undefined; projectSlug: string };

/** `fields`, naming one project by exactly one of its Project ID and its Project Slug. */
export const namingProject = <S extends z.ZodRawShape, C extends z.core.$ZodObjectConfig>(
  fields: z.ZodObject<S, C>,
) => {
  const named = fields.extend({
    projectUuid: projectIdSchema.optional(),
    projectSlug: z.string().optional(),
  });
  return named.refine(
    (input): input is z.output<typeof named> & OneProjectName =>
      (input.projectUuid === undefined) !== (input.projectSlug === undefined),
    "Name the project by exactly one of its Project ID (projectUuid) and its Project Slug",
  );
};

/** The project an input `namingProject` checked names. */
export const projectRefOf = (names: OneProjectName): ProjectRef =>
  names.projectUuid === undefined
    ? { projectSlug: names.projectSlug }
    : { projectUuid: names.projectUuid };

/** The condition selecting the project `ref` names. */
export const projectNamed = (ref: ProjectRef) =>
  "projectUuid" in ref ? eq(projects.uuid, ref.projectUuid) : eq(projects.slug, ref.projectSlug);
