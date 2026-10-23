import { describe, expect, it, vi } from "vite-plus/test";

import type { Bindings } from "../../types";
import { sendOrganizationInvitationEmail } from "./email";

describe("sendOrganizationInvitationEmail", () => {
  it("sends a branded invitation with the acceptance URL", async () => {
    const send = vi.fn().mockResolvedValue({});
    const env = { EMAIL: { send } } as unknown as Bindings;

    await sendOrganizationInvitationEmail(env, {
      to: "invitee@example.com",
      organizationName: "Acme & Co",
      inviterName: "Jane Doe",
      url: "https://app.camox.ai/accept-invitation?invitationId=invite-123",
    });

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: { name: "Camox", email: "auth@camox.ai" },
        to: "invitee@example.com",
        subject: "You're invited to join Acme & Co on Camox",
        text: expect.stringContaining("invitationId=invite-123"),
        html: expect.stringContaining("Acme &amp; Co"),
      }),
    );
  });
});
