import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownMessage } from "../components/MarkdownMessage.js";

function renderMessage(text: string): string {
  return renderToStaticMarkup(<MarkdownMessage text={text} />);
}

describe("MarkdownMessage", () => {
  it("does not render raw HTML from model output", () => {
    const html = renderMessage('<img src=x onerror=alert(1)> and **bold**');

    expect(html).not.toContain("<img");
    expect(html).not.toContain("onerror");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("does not render a literal script tag", () => {
    const html = renderMessage("<script>alert(1)</script>");

    expect(html).not.toContain("<script");
  });

  it("renders headings, lists, inline code, and line breaks", () => {
    const html = renderMessage(
      "## Skills\n\n- Python\n- `TypeScript`\n\nDone.\nNext line.",
    );

    expect(html).toContain("<h2>Skills</h2>");
    expect(html).toContain("<li>Python</li>");
    expect(html).toContain("<li><code>TypeScript</code></li>");
    expect(html).toContain("<p>Done.<br/>");
    expect(html).toContain("Next line.</p>");
  });

  it("renders GFM formatting and fenced code", () => {
    const html = renderMessage(
      "~~old~~\n\n| Name | Value |\n| --- | --- |\n| answer | `42` |\n\n```ts\nconst answer = 42;\n```",
    );

    expect(html).toContain("<del>old</del>");
    expect(html).toContain("<table>");
    expect(html).toContain("<td>answer</td>");
    expect(html).toContain('class="language-ts"');
    expect(html).toContain("const answer = 42;");
  });

  it("renders partial Markdown while a response is streaming", () => {
    const partial = renderMessage("Here is **streaming");
    const complete = renderMessage("Here is **streaming**");

    expect(partial).toContain("Here is **streaming");
    expect(complete).toContain("Here is <strong>streaming</strong>");
  });

  it("does not emit unsafe link protocols", () => {
    const html = renderMessage("[unsafe](javascript:alert(1))");

    expect(html).not.toContain("javascript:");
  });
});
