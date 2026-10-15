import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { MAX_PDF_PAGES } from "@portfolio/shared";
import { PdfAttachmentError, validatePdfAttachments } from "./pdfAttachments.js";

async function makePdfBase64(pageCount: number): Promise<string> {
  const document = await PDFDocument.create();
  for (let page = 0; page < pageCount; page += 1) {
    document.addPage();
  }
  return Buffer.from(await document.save()).toString("base64");
}

function pdfAttachment(data: string) {
  return { id: "pdf1", name: "report.pdf", mimeType: "application/pdf", data };
}

describe("validatePdfAttachments", () => {
  it("accepts readable PDFs within the page limit", async () => {
    await expect(
      validatePdfAttachments([pdfAttachment(await makePdfBase64(MAX_PDF_PAGES))]),
    ).resolves.toBeUndefined();
  });

  it("rejects a PDF over the server-side page limit", async () => {
    await expect(
      validatePdfAttachments([pdfAttachment(await makePdfBase64(MAX_PDF_PAGES + 1))]),
    ).rejects.toMatchObject({
      name: "PdfAttachmentError",
      message: expect.stringContaining(`up to ${MAX_PDF_PAGES} pages`),
    });
  });

  it("rejects malformed PDF data with an attachment error", async () => {
    await expect(
      validatePdfAttachments([pdfAttachment(Buffer.from("not a PDF").toString("base64"))]),
    ).rejects.toBeInstanceOf(PdfAttachmentError);
  });

  it("limits concurrent PDF validations", async () => {
    const data = await makePdfBase64(1);
    const results = await Promise.allSettled(
      Array.from({ length: 3 }, () => validatePdfAttachments([pdfAttachment(data)])),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ code: "TOO_MANY_CONCURRENT" }),
    });
  });

  it("terminates validation when the request is aborted", async () => {
    const controller = new AbortController();
    const validation = validatePdfAttachments([pdfAttachment(await makePdfBase64(1))], controller.signal);
    controller.abort();

    await expect(validation).rejects.toMatchObject({ name: "AbortError" });
  });
});
