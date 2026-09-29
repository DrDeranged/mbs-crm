import { EMAIL_BRAND_LOGO_URL, getEmailAppOrigin } from "./brand";

export function buildApplicationConfirmationEmail(trackingToken: string): string {
  const statusUrl = `${getEmailAppOrigin()}/apply/status`;
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;color:#1e293b;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:20px 32px;border-bottom:1px solid #e2e8f0;">
          <img src="${EMAIL_BRAND_LOGO_URL}" alt="My Business Solutions logo" width="116" />
          <p>Financing made simple</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <h2>We received your application!</h2>
          <p>Thank you for applying with My Business Solutions. Our team will review your application and be in touch shortly.</p>
          <p>Your Tracking Number: <strong>${trackingToken}</strong></p>
          <p>Use your tracking number to check your application status at any time:</p>
          <a href="${statusUrl}">Check Application Status</a>
          <p>Questions? Reply to this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}