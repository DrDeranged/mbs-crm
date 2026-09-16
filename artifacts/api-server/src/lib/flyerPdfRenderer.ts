import { renderPdf } from "./renderPdf";

export const FLYER_RENDER_CONCURRENCY = 2;
export const FLYER_RENDER_TIMEOUT_MS = 30_000;

export class FlyerRenderTimeoutError extends Error {
  readonly status = 503;

  constructor() {
    super("Flyer PDF generation timed out");
    this.name = "FlyerRenderTimeoutError";
  }
}

type PdfRenderer = (html: string) => Promise<Buffer>;

type QueuedRender = {
  html: string;
  resolve: (buffer: Buffer) => void;
  reject: (error: unknown) => void;
  started: boolean;
  settled: boolean;
  timeout: ReturnType<typeof setTimeout> | undefined;
};

/**
 * The Chromium process is shared application-wide. Only flyer generation is
 * throttled here because it is the user-triggered burst path; other PDF
 * features retain their existing behavior. Every caller's deadline starts
 * when it enters the queue. A timed-out active caller still occupies its slot
 * until Chromium actually settles, while a queued caller is removed before it
 * starts. This prevents both indefinite waiting and more than two Chromium
 * pages when renders hang.
 */
export function createFlyerPdfRenderer(
  renderer: PdfRenderer,
  {
    concurrency = FLYER_RENDER_CONCURRENCY,
    timeoutMs = FLYER_RENDER_TIMEOUT_MS,
  }: { concurrency?: number; timeoutMs?: number } = {},
) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 2) {
    throw new Error("Flyer render concurrency must be between one and two");
  }
  const pending: QueuedRender[] = [];
  let active = 0;

  const startNext = (): void => {
    while (active < concurrency && pending.length > 0) {
      const job = pending.shift();
      if (!job) return;
      if (job.settled) continue;
      active += 1;
      job.started = true;

      void Promise.resolve()
        .then(() => renderer(job.html))
        .then(
          (pdf) => {
            if (!job.settled) {
              job.settled = true;
              job.resolve(pdf);
            }
          },
          (error: unknown) => {
            if (!job.settled) {
              job.settled = true;
              job.reject(error);
            }
          },
        )
        .finally(() => {
          if (job.timeout) clearTimeout(job.timeout);
          active -= 1;
          startNext();
        });
    }
  };

  return (html: string): Promise<Buffer> => new Promise((resolve, reject) => {
    const job: QueuedRender = {
      html,
      resolve,
      reject,
      started: false,
      settled: false,
      timeout: undefined,
    };
    job.timeout = setTimeout(() => {
      if (job.settled) return;
      job.settled = true;
      if (!job.started) {
        const index = pending.indexOf(job);
        if (index >= 0) pending.splice(index, 1);
      }
      job.reject(new FlyerRenderTimeoutError());
    }, timeoutMs);
    pending.push(job);
    startNext();
  });
}

export const renderFlyerPdf = createFlyerPdfRenderer(renderPdf);