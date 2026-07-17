export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  model: string;
  system: string;
  skills: Array<{ type: string; skill_id: string }>;
  tags: string[];
}

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: "blank",
    name: "Blank agent",
    description: "A small general-purpose agent with the local file and shell tools.",
    model: "",
    system: "You are a helpful assistant. Use the workspace tools when they help complete the user's task.",
    skills: [],
    tags: [],
  },
  {
    id: "coding",
    name: "Coding assistant",
    description: "Reads, edits, and tests code in the workspace.",
    model: "",
    system: "You are a careful coding assistant. Inspect the workspace first, make focused changes, and verify them with the smallest useful test.",
    skills: [],
    tags: ["code"],
  },
  {
    id: "document",
    name: "Document assistant",
    description: "Organizes and edits workspace documents.",
    model: "",
    system: "You help users create and revise documents stored in the workspace. Keep changes clear and preserve the user's intent.",
    skills: [],
    tags: ["documents"],
  },
];
