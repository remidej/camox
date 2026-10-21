import type { Bindings } from "../types";

const ALERT_EMAIL_SENDER = { name: "Camox", email: "alerts@camox.dev" };

/**
 * What Camox emails its operator when something it runs on its own gives up for good, such as a
 * release: what failed, the details to find it by, and where to look.
 */
export type Alert = {
  subject: string;
  /** One sentence saying what failed. */
  failure: string;
  /** Labelled facts, such as the project and the commit. */
  details: { label: string; value: string }[];
  link: { label: string; url: string };
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderText(alert: Alert): string {
  return [
    alert.failure,
    "",
    ...alert.details.map(({ label, value }) => `${label}: ${value}`),
    "",
    `${alert.link.label}: ${alert.link.url}`,
  ].join("\n");
}

function renderHtml(alert: Alert): string {
  const subject = escapeHtml(alert.subject);
  const url = escapeHtml(alert.link.url);
  const details = alert.details
    .map(
      ({ label, value }) =>
        `<tr><td style="color:#737373;padding:4px 16px 4px 0;vertical-align:top">${escapeHtml(label)}</td><td style="font-family:Menlo,Consolas,monospace;padding:4px 0;word-break:break-all">${escapeHtml(value)}</td></tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${subject}</title>
  </head>
  <body style="margin:0;background:#f5f5f5;color:#171717;font-family:Arial,sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:32px">
            <tr><td style="font-size:20px;font-weight:700;padding-bottom:24px">Camox</td></tr>
            <tr><td style="font-size:16px;line-height:24px;padding-bottom:16px">${escapeHtml(alert.failure)}</td></tr>
            <tr><td style="padding-bottom:24px"><table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:20px">${details}</table></td></tr>
            <tr>
              <td>
                <a href="${url}" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;font-size:16px;font-weight:600;padding:12px 20px;border-radius:8px">${escapeHtml(alert.link.label)}</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Emails an alert to `ALERT_EMAIL_TO`, which Cloudflare Email Routing forwards to Camox's operator. */
export async function sendAlert(env: Bindings, alert: Alert): Promise<void> {
  await env.EMAIL.send({
    from: ALERT_EMAIL_SENDER,
    to: env.ALERT_EMAIL_TO,
    subject: alert.subject,
    text: renderText(alert),
    html: renderHtml(alert),
  });
}
