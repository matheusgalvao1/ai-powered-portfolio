import { parentPort, workerData } from "node:worker_threads";
import { PDFDocument } from "pdf-lib";

try {
  const document = await PDFDocument.load(new Uint8Array(workerData), {
    throwOnInvalidObject: true,
    updateMetadata: false,
  });
  parentPort?.postMessage({ ok: true, pageCount: document.getPageCount() });
} catch {
  // Do not echo parser errors: they may include attacker-controlled PDF data.
  parentPort?.postMessage({ ok: false });
} finally {
  parentPort?.close();
}
