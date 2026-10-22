/**
 * A collection's `toTitle` and `toDescription` are record templates: text with `{{field}}` tokens
 * naming the record's String fields, which the SDK writes and the API fills with each record's
 * plain text. Both sides read them the same way through these helpers.
 */

const TOKEN = /\{\{([^}]*)\}\}/g;

/** The fields a record template's tokens name, in order, such as `firstName` and `lastName`. */
export function templateFields(template: string): string[] {
  return [...template.matchAll(TOKEN)].map(([, name]) => name!);
}

/**
 * The fields a record template names that aren't String fields of the content schema's
 * properties: templates read fields as plain text, so they name no other field.
 */
export function nonStringTemplateFields(
  template: string,
  properties: Readonly<Record<string, object | undefined>>,
): string[] {
  const isString = (field: object | undefined) =>
    field !== undefined && "fieldType" in field && field.fieldType === "String";
  return templateFields(template).filter((name) => !isString(properties[name]));
}

/** How a record names itself: its title, and its description, or null when it has none. */
export type RecordText = { title: string; description: string | null };

/**
 * A record's title and description: its collection's templates filled with the plain text
 * `textOf` reads from each field they name.
 */
export function recordText(
  templates: { toTitle: string; toDescription?: string | null },
  textOf: (field: string) => string,
): RecordText {
  const fill = (template: string) =>
    template.replace(TOKEN, (_token, name: string) => textOf(name)).trim();
  return {
    title: fill(templates.toTitle),
    description: (templates.toDescription && fill(templates.toDescription)) || null,
  };
}
