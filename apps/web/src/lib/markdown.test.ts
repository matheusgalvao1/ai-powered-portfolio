import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown.js";

describe("renderMarkdown", () => {
  it("escapes HTML in model output before adding any markup", () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)> and **bold**');

    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("escapes a literal script tag", () => {
    const html = renderMarkdown("<script>alert(1)</script>");

    expect(html).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });

  it("renders bullet lists, headings, and inline code", () => {
    const html = renderMarkdown(
      "## Skills\n\n- Python\n- `TypeScript`\n\nDone.",
    );

    expect(html).toBe(
      "<h2>Skills</h2><ul><li>Python</li><li><code>TypeScript</code></li></ul><p>Done.</p>",
    );
  });
});
