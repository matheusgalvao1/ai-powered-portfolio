// Deliberately minimal: covers the subset of markdown the model actually
// produces (bold, italic, inline code, lists, headings, paragraphs). Escapes
// HTML first so model output can never inject arbitrary markup — only the
// tags this file adds itself ever reach innerHTML. `Message.tsx` must only
// ever pass this function's output to `dangerouslySetInnerHTML`, never raw
// model text.
export function renderMarkdown(text: string): string {
  const escaped = escapeHtml(text);
  const withInline = applyInlineFormatting(escaped);

  return withInline
    .split(/\n{2,}/)
    .map(renderBlock)
    .join("");
}

function applyInlineFormatting(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
}

function renderBlock(block: string): string {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return "";
  }

  if (lines.every((line) => /^[-*]\s+/.test(line))) {
    const items = lines
      .map((line) => `<li>${line.replace(/^[-*]\s+/, "")}</li>`)
      .join("");
    return `<ul>${items}</ul>`;
  }

  if (lines.every((line) => /^\d+\.\s+/.test(line))) {
    const items = lines
      .map((line) => `<li>${line.replace(/^\d+\.\s+/, "")}</li>`)
      .join("");
    return `<ol>${items}</ol>`;
  }

  const headingMatch =
    lines.length === 1 ? lines[0]?.match(/^(#{1,6})\s+(.*)$/) : null;
  if (headingMatch) {
    const level = headingMatch[1]?.length ?? 1;
    return `<h${level}>${headingMatch[2] ?? ""}</h${level}>`;
  }

  return `<p>${lines.join("<br>")}</p>`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
