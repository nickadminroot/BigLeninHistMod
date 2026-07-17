import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

const ALLOWED_SKILLS = new Set([
  "hoi4-mod-development",
  "hoi4-map",
  "hoi4-gui",
  "pi-subagents",
]);

function normalize(path: string): string {
  return resolve(path).replace(/\\/g, "/").toLocaleLowerCase();
}

function globalAgentsPath(): string {
  const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  return normalize(join(agentDir, "AGENTS.md"));
}

function stripGlobalAgents(systemPrompt: string, contextFiles: Array<{ path: string }>): string {
  const target = globalAgentsPath();
  const knownGlobalPaths = new Set(
    contextFiles
      .map((file) => normalize(file.path))
      .filter((path) => path === target),
  );
  if (knownGlobalPaths.size === 0) return systemPrompt;

  return systemPrompt.replace(
    /<project_instructions path="([^"]+)">[\s\S]*?<\/project_instructions>\s*/g,
    (block, path: string) => knownGlobalPaths.has(normalize(path)) ? "" : block,
  );
}

function filterSkillCatalog(systemPrompt: string): string {
  let filtered = systemPrompt.replace(
    /\s*<skill>\s*<name>([^<]+)<\/name>[\s\S]*?<\/skill>/g,
    (block, name: string) => ALLOWED_SKILLS.has(name.trim()) ? block : "",
  );

  const catalogPattern = /\n\nThe following skills provide specialized instructions for specific tasks\.[\s\S]*?<available_skills>([\s\S]*?)<\/available_skills>/;
  const catalog = filtered.match(catalogPattern);
  if (catalog && !catalog[1].includes("<skill>")) filtered = filtered.replace(catalogPattern, "");
  return filtered;
}

export default function projectContextExtension(pi: ExtensionAPI) {
  pi.on("before_agent_start", (event) => {
    const contextFiles = event.systemPromptOptions.contextFiles ?? [];
    const withoutGlobalAgents = stripGlobalAgents(event.systemPrompt, contextFiles);
    const filtered = filterSkillCatalog(withoutGlobalAgents);
    if (filtered === event.systemPrompt) return;
    return { systemPrompt: filtered };
  });

  pi.on("input", (event, ctx) => {
    const match = event.text.trim().match(/^\/skill:([^\s]+)/);
    if (!match || ALLOWED_SKILLS.has(match[1])) return { action: "continue" as const };
    ctx.ui.notify(`Скилл ${match[1]} отключён в проекте ${basename(ctx.cwd)}.`, "warning");
    return { action: "handled" as const };
  });
}
