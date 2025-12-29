#!/usr/bin/env node
/**
 * Systematically fix ESLint errors in batches
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const _unused_dirname = path.dirname(__filename);

/**
 * Get ESLint output
 */
function getLintErrors() {
  try {
    execSync('npm run lint', { encoding: 'utf-8', stdio: 'pipe' });
    return '';
  } catch (error) {
    return error.stdout || error.stderr || '';
  }
}

/**
 * Parse ESLint output into structured errors
 */
function parseLintOutput(output) {
  const errors = [];
  let currentFile = null;

  const lines = output.split('\n');
  for (const line of lines) {
    // Match Windows file path
    if (line.match(/^C:\\/)) {
      currentFile = line.replace(/:$/, '');
      continue;
    }

    // Match error line: "  123:45  error  message  rule-name"
    const match = line.match(/^\s*(\d+):(\d+)\s+(error|warning)\s+(.+?)\s+([@\w/-]+)$/);
    if (match && currentFile) {
      errors.push({
        file: currentFile,
        line: parseInt(match[1]),
        column: parseInt(match[2]),
        severity: match[3],
        message: match[4],
        rule: match[5]
      });
    }
  }

  return errors;
}

/**
 * Fix react/no-unescaped-entities errors
 */
function fixUnescapedEntities(filepath, errors) {
  const content = fs.readFileSync(filepath, 'utf-8');
  const lines = content.split('\n');

  // Sort errors by line and column (descending) to fix from end to start
  const entityErrors = errors
    .filter(e => e.rule === 'react/no-unescaped-entities')
    .sort((a, b) => {
      if (a.line !== b.line) return b.line - a.line;
      return b.column - a.column;
    });

  for (const error of entityErrors) {
    const lineIdx = error.line - 1;
    if (lineIdx < 0 || lineIdx >= lines.length) continue;

    let line = lines[lineIdx];
    const col = error.column - 1;

    // Check what character needs escaping
    const char = line[col];
    let replacement;

    if (char === '"') {
      replacement = '&quot;';
    } else if (char === "'") {
      replacement = '&apos;';
    } else {
      continue;
    }

    // Replace the character
    lines[lineIdx] = line.substring(0, col) + replacement + line.substring(col + 1);
  }

  if (entityErrors.length > 0) {
    fs.writeFileSync(filepath, lines.join('\n'), 'utf-8');
    return true;
  }

  return false;
}

/**
 * Fix @typescript-eslint/no-unused-vars by prefixing with _
 */
function fixUnusedVars(filepath, errors) {
  let content = fs.readFileSync(filepath, 'utf-8');
  let modified = false;

  const unusedVarErrors = errors.filter(e => e.rule === '@typescript-eslint/no-unused-vars');

  for (const error of unusedVarErrors) {
    // Extract variable name from message like "'varName' is defined but never used"
    const match = error.message.match(/'([^']+)' is (defined|assigned)/);
    if (!match) continue;

    const varName = match[1];

    // Skip if already prefixed
    if (varName.startsWith('_')) continue;

    // Pattern 1: const/let/var varName
    const pattern1 = new RegExp(`\\b(const|let|var)\\s+${varName}\\b`, 'g');
    if (pattern1.test(content)) {
      content = content.replace(pattern1, `$1 _${varName}`);
      modified = true;
      continue;
    }

    // Pattern 2: function parameter or destructured prop
    const pattern2 = new RegExp(`([({,]\\s*)${varName}(\\s*[,)}:])`, 'g');
    if (pattern2.test(content)) {
      content = content.replace(pattern2, `$1_${varName}$2`);
      modified = true;
    }
  }

  if (modified) {
    fs.writeFileSync(filepath, content, 'utf-8');
    return true;
  }

  return false;
}

/**
 * Main execution
 */
function main() {
  console.log('Getting ESLint errors...');
  const lintOutput = getLintErrors();

  console.log('Parsing errors...');
  const errors = parseLintOutput(lintOutput);
  console.log(`Found ${errors.length} total errors/warnings`);

  // Group by file
  const errorsByFile = {};
  for (const error of errors) {
    if (!errorsByFile[error.file]) {
      errorsByFile[error.file] = [];
    }
    errorsByFile[error.file].push(error);
  }

  console.log(`Files with errors: ${Object.keys(errorsByFile).length}`);

  // Count errors by type
  const errorsByType = {};
  for (const error of errors) {
    errorsByType[error.rule] = (errorsByType[error.rule] || 0) + 1;
  }

  console.log('\nError breakdown:');
  Object.entries(errorsByType)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([rule, count]) => {
      console.log(`  ${count.toString().padStart(4)} ${rule}`);
    });

  // Fix files
  let fixedEntities = 0;
  let fixedVars = 0;

  console.log('\nFixing unescaped entities...');
  for (const [filepath, fileErrors] of Object.entries(errorsByFile)) {
    try {
      if (fixUnescapedEntities(filepath, fileErrors)) {
        fixedEntities++;
        const filename = path.basename(filepath);
        console.log(`  ✓ ${filename}`);
      }
    } catch (error) {
      console.error(`  ✗ ${path.basename(filepath)}: ${error.message}`);
    }
  }

  console.log(`\nFixed unescaped entities in ${fixedEntities} files`);

  console.log('\nFixing unused variables...');
  for (const [filepath, fileErrors] of Object.entries(errorsByFile)) {
    try {
      if (fixUnusedVars(filepath, fileErrors)) {
        fixedVars++;
        const filename = path.basename(filepath);
        console.log(`  ✓ ${filename}`);
      }
    } catch (error) {
      console.error(`  ✗ ${path.basename(filepath)}: ${error.message}`);
    }
  }

  console.log(`\nFixed unused variables in ${fixedVars} files`);

  console.log('\nDone! Run "npm run lint" to see remaining errors.');
}

main();
