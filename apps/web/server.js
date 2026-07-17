import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const webDir = dirname(fileURLToPath(import.meta.url));
const publicDir = join(webDir, "public");

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

const port = process.env.PORT ? Number(process.env.PORT) : 3000;

createServer(async (req, res) => {
  const path = req.url === "/" ? "/index.html" : req.url;

  try {
    const content = await readFile(join(publicDir, path));
    res.writeHead(200, {
      "Content-Type": CONTENT_TYPES[extname(path)] ?? "application/octet-stream",
    });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
}).listen(port, () => {
  console.log(`Web listening on http://localhost:${port}`);
});
