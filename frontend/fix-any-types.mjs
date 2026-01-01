#!/usr/bin/env node
/**
 * Fix @typescript-eslint/no-explicit-any errors by replacing with appropriate types
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

/**
 * Get errors for a specific rule
 */
function getAnyTypeErrors() {
  try {
    execSync("npm run lint", { encoding: "utf-8", stdio: "pipe" });
    return "";
  } catch (error) {
    const output = error.stdout || error.stderr || "";
    const errors = [];
    let currentFile = null;

    for (const line of output.split("\n")) {
      if (line.match(/^C:\\/)) {
        currentFile = line.replace(/:$/, "");
      } else if (
        currentFile &&
        line.includes("@typescript-eslint/no-explicit-any")
      ) {
        const match = line.match(/^\s*(\d+):(\d+)\s+(error|warning)/);
        if (match) {
          errors.push({
            file: currentFile,
            line: parseInt(match[1]),
            column: parseInt(match[2]),
          });
        }
      }
    }

    return errors;
  }
}

/**
 * Determine appropriate type replacement based on context
 */
function getTypeReplacement(line, column) {
  const context = line.substring(Math.max(0, column - 50), column + 50);

  // Common patterns and their replacements
  if (context.includes("catch") || context.includes("error:")) {
    return "unknown";
  }

  if (context.includes("Record<")) {
    return "unknown";
  }

  if (context.includes("[]") || context.includes("Array")) {
    return "unknown[]";
  }

  if (context.includes("event") || context.includes("Event")) {
    return "Event";
  }

  if (
    context.includes("React.") ||
    context.includes("MouseEvent") ||
    context.includes("ChangeEvent")
  ) {
    return "unknown";
  }

  if (
    context.includes("data") ||
    context.includes("response") ||
    context.includes("result")
  ) {
    return "unknown";
  }

  if (
    context.includes("params") ||
    context.includes("props") ||
    context.includes("options")
  ) {
    return "Record<string, unknown>";
  }

  if (context.includes("FormData") || context.includes("body")) {
    return "unknown";
  }

  // Default replacement
  return "unknown";
}

/**
 * Fix any types in a file
 */
function fixAnyTypesInFile(filepath, errors) {
  const content = fs.readFileSync(filepath, "utf-8");
  const lines = content.split("\n");

  // Sort errors by line and column (descending) to fix from end to start
  const fileErrors = errors
    .filter((e) => e.file === filepath)
    .sort((a, b) => {
      if (a.line !== b.line) return b.line - a.line;
      return b.column - a.column;
    });

  let modified = false;

  for (const error of fileErrors) {
    const lineIdx = error.line - 1;
    if (lineIdx < 0 || lineIdx >= lines.length) continue;

    const line = lines[lineIdx];
    const col = error.column - 1;

    // Find 'any' keyword at this position
    const anyMatch = line.substring(col).match(/^any\b/);
    if (!anyMatch) continue;

    // Get appropriate replacement
    const replacement = getTypeReplacement(line, col);

    // Replace 'any' with the determined type
    lines[lineIdx] =
      line.substring(0, col) + replacement + line.substring(col + 3);
    modified = true;
  }

  if (modified) {
    fs.writeFileSync(filepath, lines.join("\n"), "utf-8");
    return true;
  }

  return false;
}

/**
 * Main execution
 */
function main() {
  console.log("Getting @typescript-eslint/no-explicit-any errors...");
  const errors = getAnyTypeErrors();

  if (errors.length === 0) {
    console.log("No any type errors found!");
    return;
  }

  console.log(`Found ${errors.length} any type errors`);

  // Group by file
  const fileSet = new Set(errors.map((e) => e.file));
  const files = Array.from(fileSet);

  console.log(`Files with any type errors: ${files.length}`);

  let fixedCount = 0;
  for (const filepath of files) {
    try {
      if (fixAnyTypesInFile(filepath, errors)) {
        fixedCount++;
        console.log(`  ✓ ${path.basename(filepath)}`);
      }
    } catch (error) {
      console.error(`  ✗ ${path.basename(filepath)}: ${error.message}`);
    }
  }

  console.log(`\nFixed any types in ${fixedCount} files`);
  console.log(
    'Note: Replacements use "unknown" type. Review and refine as needed.'
  );
  console.log('Run "npm run lint" to see remaining errors.');
}

main();
