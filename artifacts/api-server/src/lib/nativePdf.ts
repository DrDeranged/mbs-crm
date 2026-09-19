import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const LETTER_WIDTH = 612;
export const LETTER_HEIGHT = 792;
export const MBS_NAVY = rgb(11 / 255, 41 / 255, 72 / 255);
export const MBS_GREEN = rgb(23 / 255, 178 / 255, 106 / 255);
export const MBS_SLATE = rgb(35 / 255, 56 / 255, 76 / 255);
export const MBS_LIGHT = rgb(237 / 255, 242 / 255, 244 / 255);
export const MBS_BORDER = rgb(157 / 255, 170 / 255, 181 / 255);
export const PREPARED_BY_FOOTER_BASELINE = 14;

export type NativePdfFonts = {
  regular: PDFFont;
  bold: PDFFont;
};

const interFonts = new WeakSet<object>();

function assetCandidates(name: string): string[] {
  const root = typeof __dirname === "string" ? __dirname : process.cwd();
  return [
    path.resolve(root, "assets", name),
    path.resolve(root, "../src/assets", name),
    path.resolve(process.cwd(), "src/assets", name),
    path.resolve(process.cwd(), "dist/assets", name),
  ];
}

async function readAsset(name: string): Promise<Buffer> {
  let lastError: unknown;
  for (const candidate of assetCandidates(name)) {
    try { return await readFile(candidate); } catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error(`Could not read PDF asset ${name}`);
}

/** Embeds the light MBS logo, returning null when the optional asset is unavailable. */
export async function embedMbsLogo(pdf: PDFDocument): Promise<PDFImage | null> {
  try {
    return await pdf.embedPng(await readAsset("mbs-logo-green-slash.png"));
  } catch {
    return null;
  }
}

/** Embeds the reverse MBS logo for navy/dark surfaces. */
export async function embedMbsReverseLogo(pdf: PDFDocument): Promise<PDFImage | null> {
  try {
    return await pdf.embedPng(await readAsset("mbs-logo-green-slash-reverse.png"));
  } catch {
    return null;
  }
}

/** Creates a US Letter document with Inter when its packaged assets are available. */
export async function createLetterPdf(): Promise<{ pdf: PDFDocument; page: PDFPage; fonts: NativePdfFonts }> {
  const pdf = await PDFDocument.create();
  let regular: PDFFont;
  let bold: PDFFont;
  try {
    pdf.registerFontkit(fontkit);
    regular = await pdf.embedFont(await readAsset("Inter-Regular.ttf"), { subset: true });
    bold = await pdf.embedFont(await readAsset("Inter-SemiBold.ttf"), { subset: true });
    interFonts.add(regular);
    interFonts.add(bold);
  } catch {
    [regular, bold] = await Promise.all([
      pdf.embedFont(StandardFonts.Helvetica),
      pdf.embedFont(StandardFonts.HelveticaBold),
    ]);
  }
  return { pdf, page: pdf.addPage([LETTER_WIDTH, LETTER_HEIGHT]), fonts: { regular, bold } };
}

/**
 * Helvetica is WinAnsi. Do not allow a user-entered Unicode character to make
 * an otherwise valid package fail at save time.
 */
export function pdfText(value: unknown): string {
  return String(value ?? "")
    .replace(/[^\x20-\x7E\u2014\u00b7\u2265]/g, "-");
}

/** Applies the safe fallback punctuation policy when a standard font is used. */
export function pdfTextForFont(value: unknown, font: PDFFont): string {
  const normalized = pdfText(value);
  return interFonts.has(font) ? normalized : normalized.replace(/[\u2014\u00b7\u2265]/g, "-");
}

export function wrapPdfText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = pdfTextForFont(text, font).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (!line || font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    lines.push(line);
    // Long unbroken values (for example an email address) must still fit.
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      line = word;
      continue;
    }
    let fragment = "";
    for (const character of word) {
      if (fragment && font.widthOfTextAtSize(`${fragment}${character}`, size) > maxWidth) {
        lines.push(fragment);
        fragment = character;
      } else {
        fragment += character;
      }
    }
    line = fragment;
  }
  if (line) lines.push(line);
  return lines;
}

export function drawWrappedText(params: {
  page: PDFPage;
  text: string;
  x: number;
  y: number;
  maxWidth: number;
  font: PDFFont;
  size: number;
  lineHeight: number;
  color?: ReturnType<typeof rgb>;
}): number {
  const lines = wrapPdfText(params.text, params.font, params.size, params.maxWidth);
  let cursor = params.y;
  for (const line of lines) {
    params.page.drawText(line, {
      x: params.x,
      y: cursor,
      size: params.size,
      font: params.font,
      color: params.color ?? MBS_SLATE,
    });
    cursor -= params.lineHeight;
  }
  return cursor;
}

export async function appendPdfPages(target: PDFDocument, source: PDFDocument): Promise<void> {
  const pages = await target.copyPages(source, source.getPageIndices());
  for (const page of pages) target.addPage(page);
}

export async function addPreparedByFooters(pdf: PDFDocument, repEmail: string | null | undefined): Promise<void> {
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pageCount = pdf.getPageCount();
    const email = pdfTextForFont(repEmail ?? "", font);
  const emailSuffix = email ? ` · ${email}` : "";
  for (let index = 0; index < pageCount; index++) {
    const page = pdf.getPage(index);
    const { width } = page.getSize();
    const footer = pdfTextForFont(`Prepared by MBS${emailSuffix} · page ${index + 1} of ${pageCount}`, font);
    page.drawText(footer, {
      x: 30,
      y: PREPARED_BY_FOOTER_BASELINE,
      size: 7,
      font,
      color: rgb(0.39, 0.45, 0.52),
      maxWidth: Math.max(100, width - 60),
    });
  }
}