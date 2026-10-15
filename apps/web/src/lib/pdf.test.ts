import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { MAX_PDF_PAGES } from "@portfolio/shared";
import { PdfPageLimitError, validatePdfBytes } from "./pdf.js";

async function makePdf(pageCount: number): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let page = 0; page < pageCount; page += 1) {
    document.addPage();
  }
  return document.save();
}

describe("validatePdfBytes", () => {
  it("accepts a readable PDF within the page limit", async () => {
    await expect(validatePdfBytes(await makePdf(MAX_PDF_PAGES))).resolves.toBe(MAX_PDF_PAGES);
  });

  it("rejects PDFs that exceed the page limit", async () => {
    await expect(validatePdfBytes(await makePdf(MAX_PDF_PAGES + 1))).rejects.toBeInstanceOf(
      PdfPageLimitError,
    );
  });

  it("rejects malformed PDF data", async () => {
    await expect(validatePdfBytes(new TextEncoder().encode("not a PDF"))).rejects.toThrow();
  });
});
