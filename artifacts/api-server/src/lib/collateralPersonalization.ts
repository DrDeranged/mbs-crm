import { createHash } from "node:crypto";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import QRCode from "qrcode";
import { getBrandLogoPng } from "./brand";
import {
  createLetterPdf,
  LETTER_HEIGHT,
  LETTER_WIDTH,
  MBS_NAVY,
  pdfTextForFont,
  wrapPdfText,
} from "./nativePdf";
import { renderApplicationFormPdf, type ApplicationPdfOptions } from "./applicationPdf";

export const COMPANY_FOOTER =
  "My Business Solutions LLC · 617 Palisade Ave Unit 2, Jersey City, NJ 07307 · Business Drives Tomorrow";
export const FINANCE_APPLICATION_SOURCE_KEY = "mbs://finance-application";
export const COLLATERAL_BRAND = {
  navy: "#0B2948",
  green: "#17B26A",
  logo: "mbs-logo-green-slash.png",
  logoReverse: "mbs-logo-green-slash-reverse.png",
} as const;
export const REP_BAND_HEIGHT = 79.2; // 1.1in at 72 points/inch

export type CollateralRep = {
  name?: string | null;
  title?: string | null;
  phone?: string | null;
  mobileNumber?: string | null;
  email?: string | null;
  slug?: string | null;
  /** Some callers have multiple addresses; the corporate address is preferred. */
  emails?: string[] | null;
};

export type RepMergeFields = {
  rep: { name: string; title: string; phone: string; email: string; slug: string; qrPng: string };
  companyFooter: string;
  brand: typeof COLLATERAL_BRAND;
};

export type QrEncoderOptions = {
  errorCorrectionLevel: "L" | "M" | "Q" | "H";
  margin: number;
  color: { dark: string; light: string };
};

export type QrEncoder = (value: string, options: QrEncoderOptions) => Promise<string>;

/** Kept behind a small seam so collateral tests can verify the destination/options
 * without replacing the QR implementation (and without adding a decoder package). */
export const defaultQrEncoder: QrEncoder = (value, options) => QRCode.toDataURL(value, options);

function value(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v);
}

/** Prefer the corporate mailbox, while retaining a valid non-corporate fallback. */
export function preferredRepEmail(rep: CollateralRep): string {
  const candidates = [rep.email, ...(rep.emails ?? [])].map(value).filter(Boolean);
  return candidates.find((email) => email.toLowerCase().endsWith("@my-business-solutions.com")) ?? candidates[0] ?? "";
}

export async function createRepMergeFields(rep: CollateralRep, qrEncoder: QrEncoder = defaultQrEncoder): Promise<RepMergeFields> {
  const slug = value(rep.slug);
  const qrPng = slug
    ? await qrEncoder(`https://app.my-business-solutions.com/r/${encodeURIComponent(slug)}`, {
        errorCorrectionLevel: "H",
        margin: 4,
        color: { dark: "#0B2948", light: "#FFFFFF" },
      })
    : "";
  return {
    rep: {
      name: value(rep.name),
      title: value(rep.title),
      phone: value(rep.phone ?? rep.mobileNumber),
      email: preferredRepEmail(rep),
      slug,
      qrPng,
    },
    companyFooter: COMPANY_FOOTER,
    brand: COLLATERAL_BRAND,
  };
}

function escapeHtml(raw: string): string {
  return raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Replace dotted merge fields. Missing optional fields become empty strings (never em dashes). */
export function mergeCollateralFields(template: string, fields: RepMergeFields): string {
  return template.replace(/\{\{\s*([a-zA-Z][\w.]*)\s*\}\}/g, (_match, path: string) => {
    const parts = path.split(".");
    let current: unknown = fields;
    for (const part of parts) current = current && typeof current === "object" ? (current as Record<string, unknown>)[part] : "";
    return escapeHtml(value(current));
  });
}

/**
 * Native, pdf-lib-only HTML collateral renderer. This intentionally treats HTML as
 * content (stripping tags) rather than invoking Chromium, so it shares the native
 * Finance Application PDF pipeline and remains safe in worker environments.
 */
export async function renderCollateralHtmlPdf(template: string, rep: CollateralRep): Promise<Buffer> {
  const merged = mergeCollateralFields(template, await createRepMergeFields(rep))
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|section|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n").trim();
  const { pdf, fonts } = await createLetterPdf();
  let page = pdf.getPage(0);
  const logo = await pdf.embedPng(getBrandLogoPng());
  const logoWidth = 91;
  const logoHeight = logoWidth * logo.height / logo.width;
  page.drawImage(logo, { x: 30, y: LETTER_HEIGHT - 30 - logoHeight, width: logoWidth, height: logoHeight });
  let y = LETTER_HEIGHT - 30 - logoHeight - 24;
  for (const line of merged.split(/\n/)) {
    for (const wrapped of wrapPdfText(line.trim(), fonts.regular, 10, LETTER_WIDTH - 60)) {
      if (y < 52) { y = LETTER_HEIGHT - 42; page = pdf.addPage([LETTER_WIDTH, LETTER_HEIGHT]); }
      page.drawText(pdfTextForFont(wrapped, fonts.regular), { x: 30, y, size: 10, font: fonts.regular, color: MBS_NAVY });
      y -= 14;
    }
  }
  page.drawText(COMPANY_FOOTER, { x: 30, y: 24, size: 7, font: fonts.regular, color: MBS_NAVY, maxWidth: LETTER_WIDTH - 60 });
  return Buffer.from(await pdf.save());
}

/** Finance Application is an HTML collateral template backed by its existing renderer. */
export function renderFinanceApplicationCollateral(options: ApplicationPdfOptions): Promise<Buffer> {
  return renderApplicationFormPdf(options);
}

async function drawRepBand(page: import("pdf-lib").PDFPage, pdf: PDFDocument, rep: CollateralRep): Promise<void> {
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawRectangle({ x: 0, y: 0, width: LETTER_WIDTH, height: REP_BAND_HEIGHT, color: rgb(1, 1, 1) });
  const logo = await pdf.embedPng(getBrandLogoPng());
  const logoWidth = 91;
  page.drawImage(logo, { x: 20, y: 14, width: logoWidth, height: logoWidth * logo.height / logo.width });
  const email = preferredRepEmail(rep);
  const lines = [value(rep.name), value(rep.title), value(rep.phone ?? rep.mobileNumber), email].filter(Boolean);
  let y = 58;
  for (const line of lines) {
    page.drawText(pdfTextForFont(line, regular), { x: 130, y, size: line === lines[0] ? 11 : 8, font: line === lines[0] ? bold : regular, color: MBS_NAVY });
    y -= 12;
  }
  page.drawText(COMPANY_FOOTER, { x: 130, y: 8, size: 5.5, font: regular, color: MBS_NAVY, maxWidth: 370 });
  const fields = await createRepMergeFields(rep);
  if (fields.rep.qrPng) {
    const qr = await pdf.embedPng(Buffer.from(fields.rep.qrPng.split(",")[1], "base64"));
    page.drawImage(qr, { x: 530, y: 8, width: 62, height: 62 });
  }
}

export async function renderImageOverlayPdf(source: Buffer, sourceFormat: "pdf" | "png", rep: CollateralRep): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  if (sourceFormat === "pdf") {
    const input = await PDFDocument.load(source);
    const pages = await pdf.copyPages(input, input.getPageIndices());
    for (const imported of pages) {
      pdf.addPage(imported);
      await drawRepBand(imported, pdf, rep);
    }
  } else {
    const page = pdf.addPage([LETTER_WIDTH, LETTER_HEIGHT]);
    const image = await pdf.embedPng(source);
    const scale = Math.min(LETTER_WIDTH / image.width, (LETTER_HEIGHT - REP_BAND_HEIGHT) / image.height);
    page.drawImage(image, { x: (LETTER_WIDTH - image.width * scale) / 2, y: REP_BAND_HEIGHT, width: image.width * scale, height: image.height * scale });
    await drawRepBand(page, pdf, rep);
  }
  return Buffer.from(await pdf.save());
}

export async function renderImageOverlayPng(): Promise<never> {
  throw new Error("PNG image_overlay output is unavailable: sharp is not installed; refusing to alter artwork with an alternate rasterizer");
}

export type CollateralTemplateKind = "html" | "image_overlay";
export type CollateralOutputFormat = "pdf" | "png";

/**
 * Single renderer entry point for library callers. PNG is deliberately explicit:
 * pdf-lib can create PDFs, but cannot rasterize to the requested 1600px artifact.
 */
export async function renderCollateral(params: {
  kind: CollateralTemplateKind;
  source: string | Buffer;
  sourceFormat?: "pdf" | "png";
  rep: CollateralRep;
  format: CollateralOutputFormat;
}): Promise<Buffer> {
  if (params.format === "png") return renderImageOverlayPng();
  if (params.kind === "html") {
    if (typeof params.source !== "string") throw new Error("HTML collateral source must be a string");
    return renderCollateralHtmlPdf(params.source, params.rep);
  }
  if (!params.sourceFormat) throw new Error("image_overlay sourceFormat is required");
  if (typeof params.source === "string") throw new Error("image_overlay source must be binary artwork");
  return renderImageOverlayPdf(params.source, params.sourceFormat, params.rep);
}

export function collateralRenderSha(templateSource: string, rep: CollateralRep): string {
  return createHash("sha256").update(templateSource).update(JSON.stringify({
    name: value(rep.name), title: value(rep.title), phone: value(rep.phone ?? rep.mobileNumber),
    email: preferredRepEmail(rep), slug: value(rep.slug),
  })).digest("hex");
}