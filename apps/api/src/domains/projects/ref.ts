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

type ProjectNames = { projectUuid?: string; projectSlug?: string };

/** The fields an input names its project by: exactly one of them, `namesOneProject` checks. */
export const projectNames = {
  projectUuid: projectIdSchema.optional(),
  projectSlug: z.string().optional(),
};

/** Whether `names` holds exactly one name of a project. */
export const isOneProject = ({ projectUuid, projectSlug }: ProjectNames) =>
  (projectUuid === undefined) !== (projectSlug === undefined);

export const oneProjectError = {
  message: "Name the project by exactly one of its Project ID (projectUuid) and its Project Slug",
};

/** `schema`, holding `projectNames`, requiring exactly one of them. */
export const namesOneProject = <S extends z.ZodType>(schema: S) =>
  schema.refine((input) => isOneProject(input as ProjectNames), oneProjectError) as S;

/** An input naming one project (see `ProjectRef`), with `shape`. */
export const namingProject = <S extends z.ZodRawShape>(shape: S) =>
  namesOneProject(z.object({ ...projectNames, ...shape }));

/** The project an input `namesOneProject` names. */
export const projectRefOf = ({ projectUuid, projectSlug }: ProjectNames): ProjectRef =>
  projectUuid === undefined ? { projectSlug: projectSlug! } : { projectUuid };

/** The condition selecting the project `ref` names. */
export const projectNamed = (ref: ProjectRef) =>
  "projectUuid" in ref ? eq(projects.uuid, ref.projectUuid) : eq(projects.slug, ref.projectSlug);
