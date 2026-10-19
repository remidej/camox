import { z, type ZodType } from "zod";

/** The `locale` every localized tool takes (ADR 0015). */
export const localeInput = z
  .string()
  .min(1)
  .optional()
  .describe(
    "The locale to read or write, by its BCP 47 tag, such as `de`. Omit it for the default " +
      "locale. listLocales lists the draft's locales.",
  );

/** A localized tool's input schema: its own, taking an optional `locale` too. */
export function withLocaleInput(schema: ZodType): ZodType {
  if (schema instanceof z.ZodObject) return schema.safeExtend({ locale: localeInput });
  if (schema instanceof z.ZodUnion) {
    return z.union((schema.options as ZodType[]).map(withLocaleInput));
  }
  throw new Error("A localized tool's input must be an object, or a union of objects.");
}

/**
 * The locale a localized tool's arguments name, if any. An invalid one names none: validating
 * the arguments against the tool's input reports it.
 */
export function localeArgument(args: unknown): string | undefined {
  if (typeof args !== "object" || args === null || !("locale" in args)) return undefined;
  const parsed = localeInput.safeParse(args.locale);
  return parsed.success ? parsed.data : undefined;
}
