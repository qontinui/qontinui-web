# New Automation 11/25/2025

A new automation workflow

## Project Structure

- `scripts/` - Main automation scripts
- `lib/` - Reusable library functions
- `workflows/` - Workflow definitions

## Getting Started

1. Write your Python automation scripts in the `scripts/` directory
2. Create reusable functions in the `lib/` directory
3. Define workflows in the `workflows/` directory

## Example

See `scripts/example.py` for a simple example.

## Notes

- All Python files are executed in a sandboxed environment
- Only whitelisted imports are allowed (re, json, math, datetime, etc.)
- Maximum execution timeout: 60 seconds
- Maximum file size: 1MB per file
- Maximum project size: 100MB

---

*Project created with Qontinui*
