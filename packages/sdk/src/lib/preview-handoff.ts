export interface PreviewTarget {
  /** The Project ID of the project the CLI or dev server targets. */
  projectUuid: string;
  apiUrl: string;
}

/** Validate the destination before exchanging any credential with its backend. */
export function validatePreviewTarget(raw: string | null, target: PreviewTarget): string | null {
  if (raw === null) return null;
  try {
    const expected = JSON.parse(raw);
    if (
      expected.projectUuid === target.projectUuid &&
      typeof expected.apiUrl === "string" &&
      expected.apiUrl.replace(/\/+$/, "") === target.apiUrl.replace(/\/+$/, "")
    )
      return null;
  } catch {
    // Malformed handoffs must not silently fall back to the public page.
  }
  return "Preview destination does not match the CLI project or backend. Check --cwd and --url, then run camox preview again.";
}
