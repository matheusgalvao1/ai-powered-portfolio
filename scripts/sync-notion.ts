import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client, isFullBlock, isFullPage } from "@notionhq/client";
import type {
  BlockObjectResponse,
  RichTextItemResponse,
} from "@notionhq/client/build/src/api-endpoints.js";

type BlockWithChildren = BlockObjectResponse & {
  children?: BlockWithChildren[];
};

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_ROOT_PAGE_ID = process.env.NOTION_ROOT_PAGE_ID;

if (!NOTION_API_KEY || !NOTION_ROOT_PAGE_ID) {
  console.error(
    "Missing NOTION_API_KEY or NOTION_ROOT_PAGE_ID. Set them in .env before running this script.",
  );
  process.exit(1);
}

const repoRootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = join(repoRootDir, "knowledge/knowledge-base.md");

const notion = new Client({ auth: NOTION_API_KEY });

async function fetchAllChildren(blockId: string): Promise<BlockWithChildren[]> {
  const blocks: BlockWithChildren[] = [];
  let cursor: string | undefined;

  do {
    const response = await notion.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const result of response.results) {
      if (!isFullBlock(result)) {
        continue;
      }

      const block: BlockWithChildren = result;
      if (block.has_children) {
        block.children = await fetchAllChildren(block.id);
      }
      blocks.push(block);
    }

    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return blocks;
}

function richTextToMarkdown(richText: RichTextItemResponse[] = []): string {
  return richText
    .map((segment) => {
      let text = segment.plain_text;
      if (segment.annotations.code) text = `\`${text}\``;
      if (segment.annotations.bold) text = `**${text}**`;
      if (segment.annotations.italic) text = `*${text}*`;
      if (segment.href) text = `[${text}](${segment.href})`;
      return text;
    })
    .join("");
}

function blockToMarkdownLine(block: BlockObjectResponse): string | null {
  switch (block.type) {
    case "heading_1":
      return `# ${richTextToMarkdown(block.heading_1.rich_text)}`;
    case "heading_2":
      return `## ${richTextToMarkdown(block.heading_2.rich_text)}`;
    case "heading_3":
      return `### ${richTextToMarkdown(block.heading_3.rich_text)}`;
    case "paragraph":
      return richTextToMarkdown(block.paragraph.rich_text);
    case "bulleted_list_item":
      return `- ${richTextToMarkdown(block.bulleted_list_item.rich_text)}`;
    case "numbered_list_item":
      return `1. ${richTextToMarkdown(block.numbered_list_item.rich_text)}`;
    case "quote":
      return `> ${richTextToMarkdown(block.quote.rich_text)}`;
    case "code":
      return `\`\`\`\n${richTextToMarkdown(block.code.rich_text)}\n\`\`\``;
    case "divider":
      return "---";
    default:
      return null;
  }
}

function blockToLines(block: BlockWithChildren, depth = 0): string[] {
  const line = blockToMarkdownLine(block);
  const indent = "  ".repeat(depth);
  const lines = line ? [`${indent}${line}`] : [];

  for (const child of block.children ?? []) {
    lines.push(...blockToLines(child, depth + 1));
  }

  return lines;
}

// Consecutive list items of the same kind are joined into one tight block
// (no blank line between them); everything else starts a new block.
function blocksToMarkdown(blocks: BlockWithChildren[]): string {
  const groups: string[][] = [];
  let previousType: string | null = null;

  for (const block of blocks) {
    const lines = blockToLines(block);
    if (lines.length === 0) {
      continue;
    }

    const isList =
      block.type === "bulleted_list_item" || block.type === "numbered_list_item";

    if (isList && block.type === previousType) {
      groups[groups.length - 1]?.push(...lines);
    } else {
      groups.push(lines);
    }

    previousType = block.type;
  }

  return groups.map((group) => group.join("\n")).join("\n\n");
}

async function fetchPageTitle(pageId: string): Promise<string> {
  const page = await notion.pages.retrieve({ page_id: pageId });

  if (!isFullPage(page)) {
    return "";
  }

  const titleProperty = page.properties.title;
  const richText = titleProperty?.type === "title" ? titleProperty.title : [];

  return richTextToMarkdown(richText);
}

const [title, blocks] = await Promise.all([
  fetchPageTitle(NOTION_ROOT_PAGE_ID),
  fetchAllChildren(NOTION_ROOT_PAGE_ID),
]);

const markdown = [`# ${title}`, blocksToMarkdown(blocks)].join("\n\n");

writeFileSync(outputPath, `${markdown.trim()}\n`);

console.log(`Synced ${blocks.length} top-level blocks from Notion.`);
console.log(`Wrote knowledge base to ${outputPath}`);
