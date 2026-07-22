import { z } from "zod";
import type { PortfolioData } from "./portfolio.js";
import type { RegisteredTool } from "./types.js";

const ListProjectsInputSchema = z.object({
  skill: z.string().optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

export function createListProjectsTool(data: PortfolioData): RegisteredTool {
  return {
    name: "list_projects",
    description:
      "List portfolio projects from the structured project data, optionally filtered by a skill/technology name.",
    inputSchema: ListProjectsInputSchema,
    execute: (input) => {
      const { skill, limit } = ListProjectsInputSchema.parse(input);

      let projects = data.projects;
      if (skill) {
        const needle = skill.toLowerCase();
        projects = projects.filter((project) =>
          [...project.technologies, ...project.tags].some((entry) =>
            entry.toLowerCase().includes(needle),
          ),
        );
      }

      const limited = limit ? projects.slice(0, limit) : projects;

      if (limited.length === 0) {
        return {
          projects: [],
          note: "No structured project entries matched. The knowledge base sections (Experience, Skills) may still cover relevant work — rely on those for project details.",
        };
      }

      return { projects: limited, total: projects.length };
    },
  };
}
