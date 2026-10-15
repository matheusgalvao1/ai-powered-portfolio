import { MAX_PDF_PAGES } from "@portfolio/shared";

export class PdfPageLimitError extends Error {
  constructor(pageCount: number) {
    super(`PDFs may have up to ${MAX_PDF_PAGES} pages; this file has ${pageCount}.`);
    this.name = "PdfPageLimitError";
  }
}

export async function validatePdfBytes(data: Uint8Array): Promise<number> {
  const { PDFDocument } = await import("pdf-lib");
  const document = await PDFDocument.load(data, {
    throwOnInvalidObject: true,
    updateMetadata: false,
  });
  const pageCount = document.getPageCount();

  if (pageCount < 1) {
    throw new Error("PDFs must contain at least one page.");
  }
  if (pageCount > MAX_PDF_PAGES) {
    throw new PdfPageLimitError(pageCount);
  }

  return pageCount;
}
