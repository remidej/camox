import type { Bindings } from "../types";
import { escapeHtml, sendEmail } from "./email";

const ALERT_EMAIL_SENDER = { name: "Camox", email: "alerts@camox.dev" };

/**
 * What Camox emails to its alerts address when something it runs on its own gives up for good,
 * such as a release: what failed, the details to find it by, and where to look.
 */
export type Alert = {
  subject: string;
  /** One sentence saying what failed. */
  failure: string;
  /** Labelled facts, such as the project and the commit. */
  details: { label: string; value: string }[];
  link: { label: string; url: string };
};

function renderText(alert: Alert): string {
  return [
    alert.failure,
    "",
    ...alert.details.map(({ label, value }) => `${label}: ${value}`),
    "",
    `${alert.link.label}: ${alert.link.url}`,
  ].join("\n");
}

function renderContentHtml(alert: Alert): string {
  const details = alert.details
    .map(
      ({ label, value }) =>
        `<tr><td style="color:#737373;padding:4px 16px 4px 0;vertical-align:top">${escapeHtml(label)}</td><td style="font-family:Menlo,Consolas,monospace;padding:4px 0;word-break:break-all">${escapeHtml(value)}</td></tr>`,
    )
    .join("");
  return `<tr><td style="font-size:16px;line-height:24px;padding-bottom:16px">${escapeHtml(alert.failure)}</td></tr>
            <tr><td style="padding-bottom:24px"><table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:20px">${details}</table></td></tr>`;
}

/** Emails an alert from `alerts@camox.dev` to the alerts address, `ALERT_EMAIL_TO`. */
export async function sendAlert(env: Bindings, alert: Alert): Promise<void> {
  await sendEmail(env, {
    from: ALERT_EMAIL_SENDER,
    to: env.ALERT_EMAIL_TO,
    subject: alert.subject,
    text: renderText(alert),
    title: alert.subject,
    contentHtml: renderContentHtml(alert),
    action: alert.link,
  });
}
