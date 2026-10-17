import { vi } from "vite-plus/test";

// Every integration test sends realtime messages to the recording rooms rather than to the
// Durable Objects, which could receive a request after its test file ended.
vi.mock("../src/lib/project-rooms", async () => {
  const { recordingRooms } = await import("./project-rooms");
  return { projectRooms: recordingRooms };
});
