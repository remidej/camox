export interface PreviewTarget {
  projectSlug: string;
  environmentName?: string;
  apiUrl: string;
}

/** Validate the destination before exchanging any credential with its backend. */
export function validatePreviewTarget(raw: string | null, target: PreviewTarget): string | null {
  if (raw === null) return null;
  try {
    const expected = JSON.parse(raw);
    if (
      expected.projectSlug === target.projectSlug &&
      expected.environmentName === target.environmentName &&
      typeof expected.apiUrl === "string" &&
      expected.apiUrl.replace(/\/+$/, "") === target.apiUrl.replace(/\/+$/, "")
    )
      return null;
  } catch {
    // Malformed handoffs must not silently fall back to published content.
  }
  return "Preview destination does not match the CLI project, backend, or environment. Check --cwd and --url, then run camox preview again.";
}
