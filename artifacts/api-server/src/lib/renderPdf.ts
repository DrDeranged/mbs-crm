import puppeteer from "puppeteer";

export async function renderPdf(html: string): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: 30000 });
    const pdfUint8Array = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
    return Buffer.from(pdfUint8Array);
  } finally {
    await browser.close();
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderTemplate(htmlTemplate: string, fieldValues: Record<string, string>): string {
  return htmlTemplate.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const raw = fieldValues[key];
    return raw == null ? "" : escapeHtml(String(raw));
  });
}
