import { existsSync, readFileSync } from "node:fs";
import { PortfolioDataSchema, type PortfolioData } from "@portfolio/tools";

// Loads the structured portfolio artifact the data tools read from. Falls
// back to the committed placeholder example so a fresh clone runs without
// the real (gitignored) file.
export function loadPortfolioData({
  portfolioPath,
  examplePath,
}: {
  portfolioPath: string;
  examplePath: string;
}): PortfolioData {
  const path = existsSync(portfolioPath) ? portfolioPath : examplePath;
  if (path === examplePath) {
    console.warn(
      `[portfolio] ${portfolioPath} not found — using placeholder data from ${examplePath}`,
    );
  }

  return PortfolioDataSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}
