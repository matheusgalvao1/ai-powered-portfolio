import { Worker } from "node:worker_threads";
import type { ChatAttachment } from "@portfolio/shared";
import { ChatErrorCode as ChatErrorCodes, MAX_PDF_PAGES } from "@portfolio/shared";

const PDF_VALIDATION_TIMEOUT_MS = 5_000;
const MAX_CONCURRENT_PDF_VALIDATIONS = 2;

type PdfValidationErrorCode =
  | typeof ChatErrorCodes.VALIDATION_ERROR
  | typeof ChatErrorCodes.TOO_MANY_CONCURRENT;

export class PdfAttachmentError extends Error {
  constructor(
    message: string,
    readonly code: PdfValidationErrorCode = ChatErrorCodes.VALIDATION_ERROR,
  ) {
    super(message);
    this.name = "PdfAttachmentError";
  }
}

let activePdfValidations = 0;

function abortError(): Error {
  const error = new Error("PDF validation was cancelled");
  error.name = "AbortError";
  return error;
}

function countPdfPages(name: string, data: string, signal?: AbortSignal): Promise<number> {
  if (signal?.aborted) {
    return Promise.reject(abortError());
  }

  if (activePdfValidations >= MAX_CONCURRENT_PDF_VALIDATIONS) {
    return Promise.reject(
      new PdfAttachmentError(
        "PDF processing is busy. Please try again shortly.",
        ChatErrorCodes.TOO_MANY_CONCURRENT,
      ),
    );
  }

  activePdfValidations += 1;
  const bytes = Uint8Array.from(Buffer.from(data, "base64"));

  return new Promise<number>((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let worker: Worker;

    const cleanup = () => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      signal?.removeEventListener("abort", onAbort);
    };

    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      void worker.terminate().catch(() => {});
      reject(error);
    };

    const onAbort = () => fail(abortError());

    try {
      worker = new Worker(new URL("./pdfPageCountWorker.mjs", import.meta.url), {
        workerData: bytes,
        transferList: [bytes.buffer],
        resourceLimits: {
          maxOldGenerationSizeMb: 64,
          maxYoungGenerationSizeMb: 16,
        },
      });
    } catch {
      reject(new PdfAttachmentError(`Could not process ${name}. Try a valid PDF file.`));
      return;
    }

    worker.once("message", (result: unknown) => {
      if (
        typeof result === "object" &&
        result !== null &&
        "ok" in result &&
        result.ok === true &&
        "pageCount" in result &&
        typeof result.pageCount === "number"
      ) {
        settled = true;
        cleanup();
        resolve(result.pageCount);
        return;
      }

      fail(new PdfAttachmentError(`${name} is not a valid, readable, unencrypted PDF.`));
    });
    worker.once("error", () => {
      fail(new PdfAttachmentError(`Could not process ${name}. Try a valid PDF file.`));
    });
    worker.once("exit", (code) => {
      if (!settled) {
        fail(
          new PdfAttachmentError(
            code === 0
              ? `${name} is not a valid, readable, unencrypted PDF.`
              : `Could not process ${name}. Try a valid PDF file.`,
          ),
        );
      }
    });

    timeout = setTimeout(
      () => fail(new PdfAttachmentError(`Processing ${name} took too long. Try a smaller PDF.`)),
      PDF_VALIDATION_TIMEOUT_MS,
    );
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
    }
  }).finally(() => {
    activePdfValidations -= 1;
  });
}

export async function validatePdfAttachments(
  attachments: ChatAttachment[] | undefined,
  signal?: AbortSignal,
): Promise<void> {
  for (const attachment of attachments ?? []) {
    if (attachment.mimeType !== "application/pdf") {
      continue;
    }

    const pageCount = await countPdfPages(attachment.name, attachment.data, signal);
    if (pageCount < 1) {
      throw new PdfAttachmentError(`${attachment.name} must contain at least one page.`);
    }
    if (pageCount > MAX_PDF_PAGES) {
      throw new PdfAttachmentError(
        `${attachment.name} has ${pageCount} pages. PDFs may have up to ${MAX_PDF_PAGES} pages.`,
      );
    }
  }
}
