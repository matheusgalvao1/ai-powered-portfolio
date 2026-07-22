import { z } from "zod";
import type { PortfolioData } from "./portfolio.js";
import type { RegisteredTool } from "./types.js";

export function createGetContactInformationTool(data: PortfolioData): RegisteredTool {
  return {
    name: "get_contact_information",
    description: "Return the owner's public contact information (email, LinkedIn, GitHub).",
    inputSchema: z.object({}),
    execute: () => data.contact,
  };
}
