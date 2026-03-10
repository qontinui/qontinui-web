"""Retest failed items via SDK routes (web frontend connected as SDK app)."""
import json
import urllib.request

BASE = "http://localhost:9876/ui-bridge"
results = {}

def fetch(url, method="GET", body=None, timeout=15):
    if body:
        data = json.dumps(body).encode()
        req = urllib.request.Request(url, data=data,
            headers={"Content-Type": "application/json"}, method=method)
    else:
        req = urllib.request.Request(url, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode()
        try:
            parsed = json.loads(raw)
        except:
            return resp.status, raw
        if isinstance(parsed, dict) and "data" in parsed and "success" in parsed:
            return resp.status, parsed["data"]
        return resp.status, parsed

def test(item, name, url, method="GET", body=None, check=None, timeout=15):
    try:
        status, data = fetch(url, method, body, timeout)
        if check:
            ok, detail = check(data, status)
        else:
            ok = status == 200
            detail = f"HTTP {status}"
        tag = "PASS" if ok else "FAIL"
        results[item] = ok
        print(f"  [{tag}] {item}: {name}")
        print(f"         {detail}")
        return data
    except Exception as e:
        results[item] = False
        print(f"  [FAIL] {item}: {name}")
        print(f"         ERROR: {e}")
        return None

def t(obj, n=300):
    s = json.dumps(obj) if not isinstance(obj, str) else obj
    return s[:n] + ("..." if len(s) > n else "")

def no_err(d, s):
    return s == 200 and not (isinstance(d, dict) and d.get("error")), t(d, 250)


print("=" * 70)
print("RETEST FAILED ITEMS VIA SDK (web frontend connected)")
print("=" * 70)

# ── Item 2: Idle Detection (SDK) ────────────────────────────────────────
print("\n--- Item 2: Loading/Pending State Detection ---")
test(2, "Idle Status (SDK)", f"{BASE}/sdk/idle-status",
    check=no_err)
test("2b", "Wait-For-Idle (SDK)", f"{BASE}/sdk/wait-for-idle",
    method="POST", body={"timeout": 3000, "minStableMs": 100},
    check=no_err)

# ── Item 6: Forms (SDK) ────────────────────────────────────────────────
print("\n--- Item 6: Form State Awareness ---")
test(6, "Forms (SDK)", f"{BASE}/sdk/forms",
    check=no_err)

# ── Item 12: Network Requests (SDK) ────────────────────────────────────
print("\n--- Item 12: Network Request Monitoring ---")
test(12, "Network Requests (SDK)", f"{BASE}/sdk/network-requests",
    check=no_err)
test("12b", "Network In-Flight (SDK)", f"{BASE}/sdk/network-requests/in-flight",
    check=no_err)

# ── Item 14: Fuzzy Element Matching (SDK) ──────────────────────────────
print("\n--- Item 14: Fuzzy Element Matching ---")
test(14, "AI Search (SDK)", f"{BASE}/sdk/ai/search",
    method="POST", body={"query": "button", "maxResults": 5},
    check=no_err, timeout=20)
# Try ai/find on SDK path
test("14b", "AI Find (SDK)", f"{BASE}/sdk/ai/find",
    method="POST", body={"query": "navigation link"},
    check=no_err, timeout=20)

# ── Item 15: Undo/Redo (SDK) ──────────────────────────────────────────
print("\n--- Item 15: Undo/Redo Awareness ---")
# Check SDK snapshot for undoRedo field
test(15, "SDK Snapshot (undoRedo field)", f"{BASE}/sdk/snapshot",
    check=lambda d, s: (
        s == 200 and isinstance(d, dict) and "undoRedo" in d,
        f"keys={sorted(d.keys()) if isinstance(d, dict) else '?'}"
    ), timeout=20)

# Also check undo-state on SDK if it exists
test("15b", "Undo State (SDK)", f"{BASE}/sdk/undo-state",
    check=no_err)

# ── Item 9: Keyboard Shortcuts ────────────────────────────────────────
print("\n--- Item 9: Keyboard Shortcut Discovery ---")
# Try SDK endpoint
test(9, "Keyboard Shortcuts (SDK)", f"{BASE}/sdk/keyboard-shortcuts",
    check=no_err)

# ═══════════════════════════════════════════════════════════════════════
print("\n" + "=" * 70)
print("SDK RETEST SUMMARY")
print("=" * 70)

NAMES = {
    2: "Loading/Pending State Detection",
    6: "Form State Awareness",
    9: "Keyboard Shortcut Discovery",
    12: "Network Request Monitoring",
    14: "Fuzzy Element Matching",
    15: "Undo/Redo Awareness",
}

for i in sorted(k for k in results if isinstance(k, int)):
    tag = "PASS" if results[i] else "FAIL"
    print(f"  [{tag}] Item {i:2d}: {NAMES.get(i, '?')}")

passed = sum(1 for k, v in results.items() if isinstance(k, int) and v)
total = sum(1 for k in results if isinstance(k, int))
print(f"\n  {passed}/{total} passed")
