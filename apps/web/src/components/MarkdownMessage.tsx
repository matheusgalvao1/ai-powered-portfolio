import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

export function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className="message-body">
      <Markdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        // Model output is Markdown, not trusted HTML.
        skipHtml
      >
        {text}
      </Markdown>
    </div>
  );
}
