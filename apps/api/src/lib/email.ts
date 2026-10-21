import type { Bindings } from "../types";

/**
 * An email in Camox's layout: a card under the Camox name, the sender's own content, then a
 * button. Each kind of email, such as auth emails and alerts, supplies only its content.
 */
export type Email = {
  from: { name: string; email: string };
  to: string;
  subject: string;
  text: string;
  /** The page's title. */
  title: string;
  /** Text inbox previews show, hidden in the email itself. */
  preheader?: string;
  /** The content's HTML, as table rows (`<tr>`) between the Camox name and the button. */
  contentHtml: string;
  action: { label: string; url: string };
  /** HTML rows after the button, such as the link written out. */
  footerHtml?: string;
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderHtml(email: Email): string {
  const preheader =
    email.preheader === undefined
      ? ""
      : `\n    <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(email.preheader)}</div>`;
  const footer = email.footerHtml === undefined ? "" : `\n            ${email.footerHtml}`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(email.title)}</title>
  </head>
  <body style="margin:0;background:#f5f5f5;color:#171717;font-family:Arial,sans-serif">${preheader}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:32px">
            <tr><td style="font-size:20px;font-weight:700;padding-bottom:24px">Camox</td></tr>
            ${email.contentHtml}
            <tr>
              <td${footer ? ' style="padding-bottom:24px"' : ""}>
                <a href="${escapeHtml(email.action.url)}" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;font-size:16px;font-weight:600;padding:12px 20px;border-radius:8px">${escapeHtml(email.action.label)}</a>
              </td>
            </tr>${footer}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Sends an email in Camox's layout through the `EMAIL` binding. */
export async function sendEmail(env: Bindings, email: Email): Promise<void> {
  await env.EMAIL.send({
    from: email.from,
    to: email.to,
    subject: email.subject,
    text: email.text,
    html: renderHtml(email),
  });
}
