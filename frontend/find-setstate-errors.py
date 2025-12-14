#!/usr/bin/env python3
import subprocess
import sys
from pathlib import Path

def find_files_with_error():
    """Find all files with setState synchronously error"""
    frontend_dir = Path(__file__).parent
    src_dir = frontend_dir / "src"

    files_with_errors = []
    tsx_files = list(src_dir.rglob("*.tsx"))

    print(f"Checking {len(tsx_files)} files...", file=sys.stderr)

    for i, tsx_file in enumerate(tsx_files):
        if (i + 1) % 10 == 0:
            print(f"Progress: {i + 1}/{len(tsx_files)}", file=sys.stderr)

        try:
            result = subprocess.run(
                ["npx", "eslint", str(tsx_file)],
                capture_output=True,
                text=True,
                cwd=frontend_dir,
                timeout=30
            )

            if "Calling setState synchronously" in result.stdout:
                files_with_errors.append(str(tsx_file.relative_to(frontend_dir)))
        except subprocess.TimeoutExpired:
            print(f"Timeout on {tsx_file}", file=sys.stderr)
        except Exception as e:
            print(f"Error on {tsx_file}: {e}", file=sys.stderr)

    return files_with_errors

if __name__ == "__main__":
    files = find_files_with_error()
    for f in files:
        print(f)
    print(f"\nTotal files with error: {len(files)}", file=sys.stderr)
