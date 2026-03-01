export const CHECK_TYPES = [
  {
    value: "linter",
    label: "Linter",
    color: "amber",
    tools: ["eslint", "ruff", "pylint", "clippy", "custom"],
  },
  {
    value: "formatter",
    label: "Formatter",
    color: "blue",
    tools: ["prettier", "black", "rustfmt", "custom"],
  },
  {
    value: "type_checker",
    label: "Type Checker",
    color: "purple",
    tools: ["tsc", "mypy", "flow", "custom"],
  },
  {
    value: "test_runner",
    label: "Test Runner",
    color: "green",
    tools: ["jest", "pytest", "cargo-test", "vitest", "custom"],
  },
  {
    value: "security",
    label: "Security",
    color: "red",
    tools: ["bandit", "npm-audit", "cargo-audit", "snyk", "custom"],
  },
  {
    value: "build",
    label: "Build",
    color: "cyan",
    tools: ["webpack", "vite", "cargo", "tsc", "custom"],
  },
  {
    value: "custom",
    label: "Custom",
    color: "gray",
    tools: ["custom"],
  },
] as const;

export type CheckTypeValue = (typeof CHECK_TYPES)[number]["value"];

export function getToolsForCheckType(checkType: string): string[] {
  const type = CHECK_TYPES.find((t) => t.value === checkType);
  return type?.tools ? [...type.tools] : ["custom"];
}

export function getCheckTypeInfo(checkType: string) {
  return CHECK_TYPES.find((t) => t.value === checkType);
}

/**
 * Badge color classes per check type. Uses Tailwind utility classes.
 */
export const CHECK_TYPE_BADGE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  linter: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/30" },
  formatter: { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/30" },
  type_checker: { bg: "bg-purple-500/10", text: "text-purple-400", border: "border-purple-500/30" },
  test_runner: { bg: "bg-green-500/10", text: "text-green-400", border: "border-green-500/30" },
  security: { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/30" },
  build: { bg: "bg-cyan-500/10", text: "text-cyan-400", border: "border-cyan-500/30" },
  custom: { bg: "bg-gray-500/10", text: "text-gray-400", border: "border-gray-500/30" },
};

/**
 * Sensible defaults for each check_type + tool combination.
 * Used by the check creation dialog to pre-fill form fields.
 */
export interface CheckDefaults {
  name: string;
  command: string;
  description: string;
  auto_fix: boolean;
}

export const CHECK_DEFAULTS: Record<string, CheckDefaults> = {
  // Linters
  "linter:eslint": {
    name: "ESLint",
    command: "npx eslint . --ext .ts,.tsx,.js,.jsx",
    description: "Lint JavaScript/TypeScript files with ESLint",
    auto_fix: false,
  },
  "linter:ruff": {
    name: "Ruff Lint",
    command: "ruff check .",
    description: "Lint Python files with Ruff",
    auto_fix: false,
  },
  "linter:pylint": {
    name: "Pylint",
    command: "pylint **/*.py",
    description: "Lint Python files with Pylint",
    auto_fix: false,
  },
  "linter:clippy": {
    name: "Clippy",
    command: "cargo clippy -- -D warnings",
    description: "Lint Rust code with Clippy",
    auto_fix: false,
  },
  "linter:custom": {
    name: "Custom Linter",
    command: "",
    description: "",
    auto_fix: false,
  },

  // Formatters
  "formatter:prettier": {
    name: "Prettier",
    command: "npx prettier --check .",
    description: "Check formatting with Prettier",
    auto_fix: true,
  },
  "formatter:black": {
    name: "Black",
    command: "black --check .",
    description: "Check Python formatting with Black",
    auto_fix: true,
  },
  "formatter:rustfmt": {
    name: "Rustfmt",
    command: "cargo fmt --check",
    description: "Check Rust formatting with rustfmt",
    auto_fix: true,
  },
  "formatter:custom": {
    name: "Custom Formatter",
    command: "",
    description: "",
    auto_fix: true,
  },

  // Type Checkers
  "type_checker:tsc": {
    name: "TypeScript",
    command: "npx tsc --noEmit",
    description: "Type-check TypeScript files",
    auto_fix: false,
  },
  "type_checker:mypy": {
    name: "Mypy",
    command: "mypy .",
    description: "Type-check Python files with Mypy",
    auto_fix: false,
  },
  "type_checker:flow": {
    name: "Flow",
    command: "npx flow check",
    description: "Type-check JavaScript with Flow",
    auto_fix: false,
  },
  "type_checker:custom": {
    name: "Custom Type Checker",
    command: "",
    description: "",
    auto_fix: false,
  },

  // Test Runners
  "test_runner:jest": {
    name: "Jest Tests",
    command: "npx jest",
    description: "Run tests with Jest",
    auto_fix: false,
  },
  "test_runner:pytest": {
    name: "Pytest",
    command: "pytest",
    description: "Run tests with pytest",
    auto_fix: false,
  },
  "test_runner:cargo-test": {
    name: "Cargo Test",
    command: "cargo test",
    description: "Run Rust tests with cargo",
    auto_fix: false,
  },
  "test_runner:vitest": {
    name: "Vitest",
    command: "npx vitest run",
    description: "Run tests with Vitest",
    auto_fix: false,
  },
  "test_runner:custom": {
    name: "Custom Tests",
    command: "npm test",
    description: "",
    auto_fix: false,
  },

  // Security
  "security:bandit": {
    name: "Bandit",
    command: "bandit -r .",
    description: "Security scanning for Python with Bandit",
    auto_fix: false,
  },
  "security:npm-audit": {
    name: "NPM Audit",
    command: "npm audit",
    description: "Check for known vulnerabilities in npm dependencies",
    auto_fix: false,
  },
  "security:cargo-audit": {
    name: "Cargo Audit",
    command: "cargo audit",
    description: "Check for known vulnerabilities in Rust dependencies",
    auto_fix: false,
  },
  "security:snyk": {
    name: "Snyk",
    command: "npx snyk test",
    description: "Security testing with Snyk",
    auto_fix: false,
  },
  "security:custom": {
    name: "Custom Security Check",
    command: "",
    description: "",
    auto_fix: false,
  },

  // Build
  "build:webpack": {
    name: "Webpack Build",
    command: "npx webpack --mode production",
    description: "Build with Webpack",
    auto_fix: false,
  },
  "build:vite": {
    name: "Vite Build",
    command: "npx vite build",
    description: "Build with Vite",
    auto_fix: false,
  },
  "build:cargo": {
    name: "Cargo Build",
    command: "cargo build --release",
    description: "Build Rust project with cargo",
    auto_fix: false,
  },
  "build:tsc": {
    name: "TSC Build",
    command: "npx tsc --build",
    description: "Build TypeScript project",
    auto_fix: false,
  },
  "build:custom": {
    name: "Custom Build",
    command: "",
    description: "",
    auto_fix: false,
  },

  // Custom
  "custom:custom": {
    name: "Custom Check",
    command: "",
    description: "",
    auto_fix: false,
  },
};

export function getCheckDefaults(checkType: string, tool: string): CheckDefaults {
  const key = `${checkType}:${tool}`;
  return CHECK_DEFAULTS[key] ?? {
    name: `New ${tool} Check`,
    command: "",
    description: "",
    auto_fix: false,
  };
}
