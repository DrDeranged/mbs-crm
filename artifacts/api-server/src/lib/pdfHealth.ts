import { PDFDocument, StandardFonts } from "pdf-lib";

type BrowserHandle = { close(): Promise<void> };
type Launcher = { launch(options: { headless: boolean; timeout: number; executablePath?: string; args: string[] }): Promise<BrowserHandle> };
type PdfHealth = { nativeRenderer: string; puppeteer: string };

function safeBrowserFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/timeout|timed out/i.test(message)) return "unavailable:Chromium launch timed out";
  if (/could not find|cannot find|ENOENT|does not exist/i.test(message)) return "unavailable:Chromium executable not found";
  return "unavailable:Chromium launch failed";
}

/** A separate diagnostic probe: native lender PDFs never call this helper. */
export function createPdfHealthProbe({
  loadBrowser = async () => (await import("puppeteer")).default as Launcher,
  now = Date.now,
  timeoutMs = 5_000,
  cacheMs = 10 * 60 * 1_000,
}: {
  loadBrowser?: () => Promise<Launcher>;
  now?: () => number;
  timeoutMs?: number;
  cacheMs?: number;
} = {}) {
  let cached: { until: number; value: PdfHealth } | undefined;
  let inFlight: Promise<PdfHealth> | undefined;

  async function inspect(): Promise<PdfHealth> {
    let nativeRenderer = "ok";
    try {
      const pdf = await PDFDocument.create();
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      pdf.addPage().drawText("PDF renderer health check", { font });
      await pdf.save();
    } catch {
      nativeRenderer = "unavailable:Native PDF rendering failed";
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const launch = (async () => {
      const puppeteer = await loadBrowser();
      const browser = await puppeteer.launch({
        headless: true,
        timeout: timeoutMs,
        executablePath: process.env["PUPPETEER_EXECUTABLE_PATH"] || undefined,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      });
      // Close even if launch resolves after the outer timeout.
      await browser.close();
      return "ok";
    })().catch(safeBrowserFailure);
    const timeout = new Promise<string>((resolve) => {
      timer = setTimeout(() => resolve("unavailable:Chromium launch timed out"), timeoutMs);
    });
    try {
      return { nativeRenderer, puppeteer: await Promise.race([launch, timeout]) };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return (): Promise<PdfHealth> => {
    if (cached && now() < cached.until) return Promise.resolve(cached.value);
    if (!inFlight) {
      inFlight = inspect().then((value) => {
        cached = { until: now() + cacheMs, value };
        return value;
      }).finally(() => { inFlight = undefined; });
    }
    return inFlight;
  };
}

export const getPdfHealth = createPdfHealthProbe();