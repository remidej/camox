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
  /** Labelled facts, such as the project and the commit, each with a link to follow if it has one. */
  details: { label: string; value: string; url?: string }[];
  link: { label: string; url: string };
};

/** A Workflow instance in the Cloudflare dashboard, where its logs are. */
export function workflowInstanceUrl(accountId: string, workflowName: string, instanceId: string) {
  return `https://dash.cloudflare.com/${accountId}/workers/workflows/${workflowName}/instance/${encodeURIComponent(instanceId)}`;
}

function renderText(alert: Alert): string {
  return [
    alert.failure,
    "",
    ...alert.details.map(({ label, value, url }) => `${label}: ${value}${url ? ` (${url})` : ""}`),
    "",
    `${alert.link.label}: ${alert.link.url}`,
  ].join("\n");
}

function renderContentHtml(alert: Alert): string {
  const details = alert.details
    .map(({ label, value, url }) => {
      const shown = url
        ? `<a href="${escapeHtml(url)}" style="color:#171717">${escapeHtml(value)}</a>`
        : escapeHtml(value);
      return `<tr><td style="color:#737373;padding:4px 16px 4px 0;vertical-align:top">${escapeHtml(label)}</td><td style="font-family:Menlo,Consolas,monospace;padding:4px 0;word-break:break-all">${shown}</td></tr>`;
    })
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
