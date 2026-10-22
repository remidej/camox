/**
 * What the studio names a block or repeatable item by: its Summary, generated or hand-written,
 * else its title, from its definition's `toTitle` on default-locale content, else `fallback`.
 */
export function entityName(entity: { summary?: string; title?: string }, fallback: string) {
  return entity.summary || entity.title || fallback;
}
