import { escapeHtml, sendEmail } from "../../lib/email";
import type { Bindings } from "../../types";

const AUTH_EMAIL_ADDRESS = "auth@camox.ai";
const AUTH_EMAIL_SENDER = { name: "Camox", email: AUTH_EMAIL_ADDRESS };

type AuthEmail = {
  to: string;
  subject: string;
  preheader: string;
  heading: string;
  body: string;
  actionLabel: string;
  actionUrl: string;
};

async function sendAuthEmail(env: Bindings, email: AuthEmail): Promise<void> {
  const actionUrl = escapeHtml(email.actionUrl);
  await sendEmail(env, {
    from: AUTH_EMAIL_SENDER,
    to: email.to,
    subject: email.subject,
    text: `${email.heading}\n\n${email.body}\n\n${email.actionLabel}: ${email.actionUrl}`,
    title: email.heading,
    preheader: email.preheader,
    contentHtml: `<tr><td style="font-size:24px;font-weight:700;padding-bottom:12px">${escapeHtml(email.heading)}</td></tr>
            <tr><td style="font-size:16px;line-height:24px;padding-bottom:24px">${escapeHtml(email.body)}</td></tr>`,
    action: { label: email.actionLabel, url: email.actionUrl },
    footerHtml: `<tr><td style="font-size:13px;line-height:20px;color:#737373">If the button does not work, copy and paste this link into your browser:<br><a href="${actionUrl}" style="color:#404040;word-break:break-all">${actionUrl}</a></td></tr>`,
  });
}

export function sendVerificationEmail(env: Bindings, to: string, url: string): Promise<void> {
  return sendAuthEmail(env, {
    to,
    subject: "Verify your Camox email",
    preheader: "Confirm your email address to finish creating your Camox account.",
    heading: "Verify your email address",
    body: "Confirm your email address to finish creating your Camox account.",
    actionLabel: "Verify email",
    actionUrl: url,
  });
}

export function sendPasswordResetEmail(env: Bindings, to: string, url: string): Promise<void> {
  return sendAuthEmail(env, {
    to,
    subject: "Reset your Camox password",
    preheader: "Use this secure link to choose a new Camox password.",
    heading: "Reset your password",
    body: "We received a request to reset your Camox password. If you did not request this, you can safely ignore this email.",
    actionLabel: "Reset password",
    actionUrl: url,
  });
}

export function sendOrganizationInvitationEmail(
  env: Bindings,
  invitation: {
    to: string;
    organizationName: string;
    inviterName: string;
    url: string;
  },
): Promise<void> {
  return sendAuthEmail(env, {
    to: invitation.to,
    subject: `You're invited to join ${invitation.organizationName} on Camox`,
    preheader: `${invitation.inviterName} invited you to join ${invitation.organizationName} on Camox.`,
    heading: `Join ${invitation.organizationName}`,
    body: `${invitation.inviterName} invited you to collaborate in ${invitation.organizationName} on Camox.`,
    actionLabel: "View invitation",
    actionUrl: invitation.url,
  });
}
