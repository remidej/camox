import { abortAllDurableObjects } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { createProjectFixture } from "../test/fixtures";
import { signIn } from "../test/threads";
import app from "./index";

afterEach(async () => {
  await abortAllDurableObjects();
});

/** Opens a socket under `/parties`, signed in with `token`. */
const requestRoom = (path: string, token: string | null) =>
  app.request(
    path,
    { headers: { Upgrade: "websocket", ...(token ? { authorization: `Bearer ${token}` } : {}) } },
    env,
  );

const requestProjectRoom = (room: string | number, token: string | null) =>
  requestRoom(`/parties/project-room/${room}`, token);

describe("the project room socket", () => {
  it("connects a member of the project", async () => {
    const { db, memberUser, project } = await createProjectFixture(crypto.randomUUID());
    const token = await signIn(db, memberUser.id);

    const response = await requestProjectRoom(project.id, token);

    expect(response.status).toBe(101);
    const socket = response.webSocket!;
    socket.accept();
    socket.close();
  });

  it("refuses a signed-in user who isn't a member of the project", async () => {
    const { db, outsiderUser, project } = await createProjectFixture(crypto.randomUUID());
    const token = await signIn(db, outsiderUser.id);

    const response = await requestProjectRoom(project.id, token);

    expect(response.status).toBe(403);
    expect(response.webSocket).toBeNull();
  });

  it("answers a project that doesn't exist as it answers a non-member", async () => {
    const { db, memberUser } = await createProjectFixture(crypto.randomUUID());
    const token = await signIn(db, memberUser.id);

    const response = await requestProjectRoom(Number.MAX_SAFE_INTEGER, token);

    expect(response.status).toBe(403);
    expect(response.webSocket).toBeNull();
  });

  it("refuses someone signed out", async () => {
    const { project } = await createProjectFixture(crypto.randomUUID());

    const response = await requestProjectRoom(project.id, null);

    expect(response.status).toBe(401);
    expect(response.webSocket).toBeNull();
  });

  it.each(["not-a-project", "0", "-1", "1.5", "01", "1e3", "99999999999999999999"])(
    "refuses a room named %s, which isn't a project id",
    async (room) => {
      const { db, memberUser } = await createProjectFixture(crypto.randomUUID());
      const token = await signIn(db, memberUser.id);

      const response = await requestProjectRoom(room, token);

      expect(response.status).toBe(404);
      expect(response.webSocket).toBeNull();
    },
  );

  it("doesn't reach the other Durable Objects", async () => {
    const { db, memberUser, project } = await createProjectFixture(crypto.randomUUID());
    const token = await signIn(db, memberUser.id);

    const response = await requestRoom(`/parties/thread/${project.id}`, token);

    expect(response.status).toBe(404);
    expect(response.webSocket).toBeNull();
  });

  it("refuses plain requests", async () => {
    const { db, memberUser, project } = await createProjectFixture(crypto.randomUUID());
    const token = await signIn(db, memberUser.id);

    const response = await app.request(
      `/parties/project-room/${project.id}`,
      { headers: { authorization: `Bearer ${token}` } },
      env,
    );

    expect(response.status).toBe(404);
  });
});
