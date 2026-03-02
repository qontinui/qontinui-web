import {
  Container,
  FileCode,
  GitBranch,
  Hammer,
  Package,
  Terminal,
} from "lucide-react";
import type { CommandCategory } from "./shell-command-utils";
import type { ShellCommandItem } from "@/services/library-service";

export const COMMAND_CATEGORIES: CommandCategory[] = [
  {
    value: "git",
    label: "Git",
    icon: GitBranch,
    color: "text-orange-400",
    bgColor: "bg-orange-500/10",
    commands: [
      { name: "Git Status", command: "git status", description: "Show working tree status" },
      { name: "Git Pull", command: "git pull", description: "Pull latest changes" },
      { name: "Git Push", command: "git push", description: "Push commits to remote" },
    ],
  },
  {
    value: "npm",
    label: "NPM",
    icon: Package,
    color: "text-green-400",
    bgColor: "bg-green-500/10",
    commands: [
      { name: "NPM Install", command: "npm install", description: "Install dependencies" },
      { name: "NPM Build", command: "npm run build", description: "Build project" },
      { name: "NPM Test", command: "npm test", description: "Run tests" },
    ],
  },
  {
    value: "docker",
    label: "Docker",
    icon: Container,
    color: "text-cyan-400",
    bgColor: "bg-cyan-500/10",
    commands: [
      { name: "Docker PS", command: "docker ps", description: "List running containers" },
      { name: "Docker Build", command: "docker build -t app .", description: "Build Docker image" },
    ],
  },
  {
    value: "poetry",
    label: "Poetry",
    icon: FileCode,
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    commands: [
      { name: "Poetry Install", command: "poetry install", description: "Install Python dependencies" },
      { name: "Poetry Run", command: "poetry run python main.py", description: "Run with Poetry" },
    ],
  },
  {
    value: "build",
    label: "Build",
    icon: Hammer,
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    commands: [
      { name: "Make Build", command: "make build", description: "Run make build" },
      { name: "Cargo Build", command: "cargo build --release", description: "Build Rust project" },
    ],
  },
  {
    value: "general",
    label: "General",
    icon: Terminal,
    color: "text-gray-400",
    bgColor: "bg-gray-500/10",
    commands: [],
  },
];

export function inferCategory(item: ShellCommandItem): CommandCategory {
  const categoryValues = COMMAND_CATEGORIES.map((c) => c.value);

  if (item.tags) {
    for (const tag of item.tags) {
      const lower = tag.toLowerCase();
      if (categoryValues.includes(lower)) {
        return COMMAND_CATEGORIES.find((c) => c.value === lower)!;
      }
    }
  }

  const cmd = item.command.toLowerCase();
  if (cmd.startsWith("git ") || cmd.includes("&& git ")) {
    return COMMAND_CATEGORIES.find((c) => c.value === "git")!;
  }
  if (cmd.startsWith("npm ") || cmd.startsWith("npx ") || cmd.startsWith("yarn ") || cmd.startsWith("pnpm ")) {
    return COMMAND_CATEGORIES.find((c) => c.value === "npm")!;
  }
  if (cmd.startsWith("docker ") || cmd.startsWith("docker-compose ")) {
    return COMMAND_CATEGORIES.find((c) => c.value === "docker")!;
  }
  if (cmd.startsWith("poetry ") || cmd.startsWith("pip ") || cmd.startsWith("python ")) {
    return COMMAND_CATEGORIES.find((c) => c.value === "poetry")!;
  }
  if (cmd.startsWith("make ") || cmd.startsWith("cargo ") || cmd.startsWith("cmake ")) {
    return COMMAND_CATEGORIES.find((c) => c.value === "build")!;
  }

  return COMMAND_CATEGORIES.find((c) => c.value === "general")!;
}
