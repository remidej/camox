import { projectIdSchema } from "@camox/api-contract/ids";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { projects } from "./schema";

/**
 * A project as a website's code, the studio or the CLI names it: by its Project ID. Its Project
 * Slug is only an address, which these inputs don't take.
 */
export type ProjectRef = { projectUuid: string };

/** `fields`, naming one project by its Project ID. */
export const namingProject = <S extends z.ZodRawShape, C extends z.core.$ZodObjectConfig>(
  fields: z.ZodObject<S, C>,
) => fields.extend({ projectUuid: projectIdSchema });

/** The project an input `namingProject` checked names. */
export const projectRefOf = ({ projectUuid }: ProjectRef): ProjectRef => ({ projectUuid });

/** The condition selecting the project `ref` names. */
export const projectNamed = (ref: ProjectRef) => eq(projects.uuid, ref.projectUuid);
