import { eq } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import { createProjectFixture, createServiceContext, inScope } from "../../../test/fixtures";
import { answerNext, modelCalls } from "../../../test/generation";
import { runService } from "../../lib/run-service";
import { files } from "../../schema";
import { runGenerationJob } from "../generated-values/generation";
import { getFile } from "./service";

async function fixture() {
  const { db, project } = await createProjectFixture(crypto.randomUUID());
  const file = await db
    .insert(files)
    .values({
      projectId: project.id,
      url: "http://localhost/files/serve/test.png",
      alt: null,
      filename: null,
      mimeType: "image/png",
      size: 68,
      blobId: crypto.randomUUID(),
      path: "/",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .returning()
    .get();
  return { db, file };
}

describe("file metadata generation", () => {
  it("asks the model about the file's image and saves its answer beside the file", async () => {
    const { db, file } = await fixture();
    const metadata = { filename: "generated", alt: "Generated description" };
    answerNext("imageMetadata", metadata);

    await runService(runGenerationJob(db, { entity: "file", entityId: file.id, draftId: null }));

    expect(modelCalls()).toEqual([
      { method: "imageMetadata", request: expect.objectContaining({ url: file.url }) },
    ]);
    // Generated beside the file, which stays as it was (ADR 0012).
    expect(await db.select().from(files).where(eq(files.id, file.id)).get()).toEqual(file);
    expect(
      await runService(getFile(inScope(createServiceContext(db, null), null), { id: file.id })),
    ).toMatchObject({ ...metadata, aiMetadata: true });
  });
});
