"""
Verification script to list all testing API endpoints.
"""

import re
from pathlib import Path

# Read the testing.py file
testing_file = Path("app/api/v1/endpoints/testing.py")
content = testing_file.read_text()

# Extract all router decorators with their paths and methods
pattern = r'@router\.(get|post|put|patch|delete)\((.*?)\)\s+async def (\w+)'
matches = re.findall(pattern, content, re.DOTALL)

print("=" * 80)
print("TESTING API ENDPOINTS - VERIFICATION")
print("=" * 80)
print()

runner_endpoints = []
frontend_endpoints = []

for method, decorator_args, func_name in matches:
    # Extract the path from decorator args
    path_match = re.search(r'"([^"]+)"', decorator_args)
    if path_match:
        path = path_match.group(1)
    else:
        path = ""
    
    # Determine auth type by checking function signature
    func_pattern = rf'async def {func_name}\((.*?)\) -> Any:'
    func_match = re.search(func_pattern, content, re.DOTALL)
    
    if func_match:
        params = func_match.group(1)
        if 'runner_auth' in params or 'get_runner_user' in params:
            auth_type = "Runner"
            runner_endpoints.append((method.upper(), path, func_name))
        else:
            auth_type = "User"
            frontend_endpoints.append((method.upper(), path, func_name))
    else:
        auth_type = "Unknown"

print(f"Runner Endpoints ({len(runner_endpoints)}):")
print("-" * 80)
for method, path, func_name in sorted(runner_endpoints):
    print(f"  {method:6} /testing{path:50} [{func_name}]")

print()
print(f"Frontend Endpoints ({len(frontend_endpoints)}):")
print("-" * 80)
for method, path, func_name in sorted(frontend_endpoints):
    print(f"  {method:6} /testing{path:50} [{func_name}]")

print()
print("=" * 80)
print(f"TOTAL: {len(matches)} endpoints")
print("=" * 80)
