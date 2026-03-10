"""Test all AI automation wishlist items (2-17) via UI Bridge endpoints.

Tests against the RUNNER (port 9876). Runner wraps all responses in {success, data}.
Control routes: /ui-bridge/control/*  (runner's own Tauri webview)
SDK routes:     /ui-bridge/sdk/*      (proxied to external SDK app)
"""
import json
import urllib.request
import urllib.error

BASE = "http://localhost:9876/ui-bridge"

results = {}

def fetch(url, method="GET", body=None, timeout=15):
    """HTTP request → (status, parsed). Unwraps {success, data} wrapper."""
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
        # Unwrap runner's {success, data} wrapper
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


print("=" * 70)
print("UI BRIDGE AI AUTOMATION WISHLIST TEST (Items 2-17)")
print(f"Runner: {BASE}")
print("=" * 70)

# ── Fetch control snapshot ──────────────────────────────────────────────
print("\n--- Fetching snapshot ---")
try:
    _, snap = fetch(f"{BASE}/control/snapshot")
    if isinstance(snap, dict):
        print(f"  [OK] Snapshot keys: {sorted(snap.keys())}")
    else:
        snap = None
        print(f"  [WARN] Unexpected snapshot format")
except Exception as e:
    snap = None
    print(f"  [ERR] {e}")

print()

# ════════════════════════════════════════════════════════════════════════
# Item 2: Loading/Pending State Detection (idle detection)
# Routes: GET /control/idle-status, POST /control/wait-for-idle
# ════════════════════════════════════════════════════════════════════════
print("--- Item 2: Loading/Pending State Detection ---")
test(2, "Idle Status (control)", f"{BASE}/control/idle-status",
    check=lambda d, s: (
        s == 200 and isinstance(d, dict) and not d.get("error"),
        f"keys={list(d.keys())[:8]}" if isinstance(d, dict) else str(d)[:200]
    ))
test("2b", "Wait-For-Idle (control)", f"{BASE}/control/wait-for-idle",
    method="POST", body={"timeout": 3000, "minStableMs": 100},
    check=lambda d, s: (s == 200 and not (isinstance(d, dict) and d.get("error")),
        t(d, 200)))
print()

# ════════════════════════════════════════════════════════════════════════
# Item 3: Console Error/Warning Capture
# Routes: GET /control/console-errors, GET /sdk/console-errors
# ════════════════════════════════════════════════════════════════════════
print("--- Item 3: Console Error/Warning Capture ---")
test(3, "Console Errors (control)", f"{BASE}/control/console-errors",
    check=lambda d, s: (
        s == 200 and isinstance(d, (list, dict)) and not (isinstance(d, dict) and d.get("error")),
        f"type={type(d).__name__}, {t(d, 200)}"
    ))
print()

# ════════════════════════════════════════════════════════════════════════
# Item 4: Element Change Diffing
# Routes: POST/GET /control/ai/bookmarks, GET /control/ai/bookmark/:name/diff
# ════════════════════════════════════════════════════════════════════════
print("--- Item 4: Element Change Diffing ---")
test(4, "Create Bookmark", f"{BASE}/control/ai/bookmarks",
    method="POST", body={"name": "wishlist-test"},
    check=lambda d, s: (s == 200 and not (isinstance(d, dict) and d.get("error")),
        t(d, 200)))
test("4b", "List Bookmarks", f"{BASE}/control/ai/bookmarks",
    check=lambda d, s: (s == 200 and not (isinstance(d, dict) and d.get("error")),
        t(d, 200)))
test("4c", "Diff from Bookmark", f"{BASE}/control/ai/bookmark/wishlist-test/diff",
    check=lambda d, s: (s == 200 and not (isinstance(d, dict) and d.get("error")),
        t(d, 200)))
print()

# ════════════════════════════════════════════════════════════════════════
# Item 5: Page/Route Awareness (snapshot.page)
# ════════════════════════════════════════════════════════════════════════
print("--- Item 5: Page/Route Awareness ---")
if snap and isinstance(snap, dict):
    page = snap.get("page")
    if page and isinstance(page, dict):
        has_url = any(k in page for k in ["url", "pathname", "href"])
        results[5] = has_url
        print(f"  [{'PASS' if has_url else 'FAIL'}] 5: Page context in snapshot")
        print(f"         {t(page)}")
    else:
        results[5] = False
        print(f"  [FAIL] 5: 'page' is {type(page).__name__}: {page}")
else:
    results[5] = False
    print(f"  [FAIL] 5: No snapshot")
print()

# ════════════════════════════════════════════════════════════════════════
# Item 6: Form State Awareness
# Routes: GET /control/forms, GET /sdk/forms
# ════════════════════════════════════════════════════════════════════════
print("--- Item 6: Form State Awareness ---")
# Try control first, if it shows "Unknown request type", try SDK
r = test(6, "Forms (control)", f"{BASE}/control/forms",
    check=lambda d, s: (
        s == 200 and isinstance(d, (dict, list)) and not (isinstance(d, dict) and d.get("error")),
        t(d, 200)
    ))
if not results.get(6):
    test(6, "Forms (SDK)", f"{BASE}/sdk/forms",
        check=lambda d, s: (
            s == 200 and not (isinstance(d, dict) and d.get("error")),
            t(d, 200)
        ))
# Also check if snapshot elements have form state
if snap:
    elements = snap.get("elements", [])
    form_els = [e for e in elements if isinstance(e, dict) and
        e.get("type") in ("input", "select", "textarea")]
    if form_els:
        sample = form_els[0]
        state = sample.get("state", {})
        form_keys = {k for k in (state if isinstance(state, dict) else {})
            if k in ("validationState", "constraints", "required", "value")}
        if form_keys:
            print(f"  [INFO] {len(form_els)} form elements, state keys include: {form_keys}")
print()

# ════════════════════════════════════════════════════════════════════════
# Item 7: Modal/Dialog Stack (snapshot.modalStack)
# ════════════════════════════════════════════════════════════════════════
print("--- Item 7: Modal/Dialog Stack ---")
if snap and isinstance(snap, dict):
    ms = snap.get("modalStack")
    if ms is not None:
        results[7] = True
        print(f"  [PASS] 7: modalStack in snapshot")
        print(f"         {t(ms)}")
    else:
        results[7] = False
        print(f"  [FAIL] 7: 'modalStack' not in snapshot")
else:
    results[7] = False
print()

# ════════════════════════════════════════════════════════════════════════
# Item 8: Notification/Toast Detection (snapshot.toasts)
# ════════════════════════════════════════════════════════════════════════
print("--- Item 8: Notification/Toast Detection ---")
if snap and isinstance(snap, dict):
    ts = snap.get("toasts")
    if ts is not None:
        results[8] = True
        print(f"  [PASS] 8: toasts in snapshot")
        print(f"         {t(ts)}")
    else:
        results[8] = False
        print(f"  [FAIL] 8: 'toasts' not in snapshot")
else:
    results[8] = False
print()

# ════════════════════════════════════════════════════════════════════════
# Item 9: Keyboard Shortcut Discovery
# Not a dedicated route — check if snapshot or elements contain shortcut data
# ════════════════════════════════════════════════════════════════════════
print("--- Item 9: Keyboard Shortcut Discovery ---")
found_9 = False
if snap and isinstance(snap, dict):
    # Check top-level snapshot keys
    for key in ["keyboardShortcuts", "shortcuts", "hotkeys"]:
        if key in snap and snap[key]:
            found_9 = True
            results[9] = True
            print(f"  [PASS] 9: '{key}' in snapshot")
            print(f"         {t(snap[key])}")
            break
    if not found_9:
        # Check elements for aria-keyshortcuts or accesskey
        elements = snap.get("elements", [])
        shortcuts_found = []
        for el in elements:
            if isinstance(el, dict):
                state = el.get("state", {}) if isinstance(el.get("state"), dict) else {}
                attrs = el.get("attributes", {}) if isinstance(el.get("attributes"), dict) else {}
                for src in [state, attrs, el]:
                    for k in ["ariaKeyshortcuts", "aria-keyshortcuts", "accesskey", "shortcut", "keyboardShortcut"]:
                        if k in src and src[k]:
                            shortcuts_found.append({"id": el.get("id"), k: src[k]})
                            break
        if shortcuts_found:
            found_9 = True
            results[9] = True
            print(f"  [PASS] 9: Found {len(shortcuts_found)} elements with keyboard shortcuts")
            print(f"         {t(shortcuts_found[:3])}")

if not found_9:
    # Try a dedicated endpoint (may not exist)
    try:
        s, d = fetch(f"{BASE}/control/keyboard-shortcuts")
        if s == 200 and not (isinstance(d, dict) and d.get("error")):
            results[9] = True
            found_9 = True
            print(f"  [PASS] 9: Keyboard shortcuts endpoint")
            print(f"         {t(d)}")
    except:
        pass
    if not found_9:
        results[9] = False
        print(f"  [FAIL] 9: No keyboard shortcut data found (no route, no snapshot field)")
print()

# ════════════════════════════════════════════════════════════════════════
# Item 10: Scroll Position and Overflow Awareness
# Check element rects and visibility state in snapshot
# ════════════════════════════════════════════════════════════════════════
print("--- Item 10: Scroll Position and Overflow Awareness ---")
found_10 = False
if snap and isinstance(snap, dict):
    elements = snap.get("elements", [])
    scroll_keys = {"scrollPosition", "isScrollable", "overflow", "offscreen",
                   "inViewport", "visibleRect", "isOffscreen"}
    for el in elements[:100]:
        if isinstance(el, dict):
            state = el.get("state", {}) if isinstance(el.get("state"), dict) else {}
            el_and_state = {**el, **state}
            matches = set(el_and_state.keys()) & scroll_keys
            if matches:
                found_10 = True
                results[10] = True
                example = {k: el_and_state[k] for k in matches}
                print(f"  [PASS] 10: Scroll/overflow in element state")
                print(f"         element '{el.get('id', '?')}': {t(example)}")
                break
    if not found_10:
        # Check if elements have rect (bounding rect = positional awareness)
        has_rect = any(isinstance(e, dict) and "rect" in e for e in elements[:20])
        if has_rect:
            sample = next(e for e in elements[:20] if isinstance(e, dict) and "rect" in e)
            found_10 = True
            results[10] = True
            print(f"  [PASS] 10: Element rects present (positional awareness)")
            print(f"         element '{sample.get('id', '?')}' rect: {t(sample['rect'])}")

if not found_10:
    results[10] = False
    print(f"  [FAIL] 10: No scroll/overflow or rect data in elements")
print()

# ════════════════════════════════════════════════════════════════════════
# Item 11: Element Relationship Hints (snapshot.relationships)
# ════════════════════════════════════════════════════════════════════════
print("--- Item 11: Element Relationship Hints ---")
if snap and isinstance(snap, dict):
    rels = snap.get("relationships")
    if rels and isinstance(rels, dict):
        results[11] = True
        print(f"  [PASS] 11: relationships in snapshot")
        print(f"         count={json.dumps(rels.get('count', {}))}, byOrigin={json.dumps(rels.get('byOrigin', {}))}")
        rel_list = rels.get("relationships", [])
        if rel_list:
            print(f"         first: {t(rel_list[0], 200)}")
    else:
        results[11] = False
        print(f"  [FAIL] 11: 'relationships' not in snapshot or empty")
else:
    results[11] = False
print()

# ════════════════════════════════════════════════════════════════════════
# Item 12: Network Request Monitoring
# Routes: GET /control/network-requests, /in-flight
# ════════════════════════════════════════════════════════════════════════
print("--- Item 12: Network Request Monitoring ---")
test(12, "Network Requests (control)", f"{BASE}/control/network-requests",
    check=lambda d, s: (
        s == 200 and not (isinstance(d, dict) and d.get("error")),
        t(d, 200)
    ))
if not results.get(12):
    # The control handler might not recognize this command — try SDK
    test(12, "Network Requests (SDK)", f"{BASE}/sdk/network-requests",
        check=lambda d, s: (
            s == 200 and not (isinstance(d, dict) and d.get("error")),
            t(d, 200)
        ))
print()

# ════════════════════════════════════════════════════════════════════════
# Item 13: Screenshot/Visual Snapshot
# Routes: GET /control/annotated-screenshot, GET /sdk/screenshot
# ════════════════════════════════════════════════════════════════════════
print("--- Item 13: Screenshot/Visual Snapshot ---")
test(13, "Annotated Screenshot (control)", f"{BASE}/control/annotated-screenshot",
    check=lambda d, s: (
        s == 200 and not (isinstance(d, dict) and d.get("error")),
        f"type={type(d).__name__}, len={len(json.dumps(d)) if isinstance(d, (dict, list)) else len(str(d))}"
    ))
print()

# ════════════════════════════════════════════════════════════════════════
# Item 14: Fuzzy Element Matching
# Routes: POST /control/ai/search, POST /control/ai/find
# ════════════════════════════════════════════════════════════════════════
print("--- Item 14: Fuzzy Element Matching ---")
test(14, "AI Search (control)", f"{BASE}/control/ai/search",
    method="POST", body={"type": "button", "maxResults": 5},
    check=lambda d, s: (
        s == 200 and isinstance(d, dict) and d.get("scannedCount", 0) > 0,
        f"scannedCount={d.get('scannedCount', '?')}, results={len(d.get('results', []))}"
        if isinstance(d, dict) else t(d, 250)
    ))
test("14b", "AI Find (control)", f"{BASE}/control/ai/find",
    method="POST", body={"query": "navigation link"},
    check=lambda d, s: (
        s == 200 and not (isinstance(d, dict) and d.get("error")),
        t(d, 250)
    ))
print()

# ════════════════════════════════════════════════════════════════════════
# Item 15: Undo/Redo Awareness (snapshot.undoRedo + endpoint)
# ════════════════════════════════════════════════════════════════════════
print("--- Item 15: Undo/Redo Awareness ---")
if snap and isinstance(snap, dict):
    undo = snap.get("undoRedo")
    if undo is not None:
        results[15] = True
        print(f"  [PASS] 15: undoRedo in snapshot")
        print(f"         {t(undo)}")
    else:
        # Not in snapshot, try dedicated endpoint
        test(15, "Undo State (control)", f"{BASE}/control/undo-state",
            check=lambda d, s: (
                s == 200 and not (isinstance(d, dict) and d.get("error")),
                t(d, 200)
            ))
else:
    results[15] = False
print()

# ════════════════════════════════════════════════════════════════════════
# Item 16: Clipboard Integration
# Routes: GET/POST /control/clipboard (arboard — Rust native)
# ════════════════════════════════════════════════════════════════════════
print("--- Item 16: Clipboard Integration ---")
test(16, "Clipboard Read", f"{BASE}/control/clipboard",
    check=lambda d, s: (
        s == 200 and isinstance(d, dict) and "text" in d,
        t(d, 200)
    ))
test("16b", "Clipboard Write", f"{BASE}/control/clipboard",
    method="POST", body={"text": "wishlist-test-roundtrip-2025"},
    check=lambda d, s: (s == 200, f"HTTP {s}"))
test("16c", "Clipboard Roundtrip", f"{BASE}/control/clipboard",
    check=lambda d, s: (
        s == 200 and isinstance(d, dict) and d.get("text") == "wishlist-test-roundtrip-2025",
        f"text={d.get('text', 'MISSING')[:60]}" if isinstance(d, dict) else str(d)[:100]
    ))
print()

# ════════════════════════════════════════════════════════════════════════
# Item 17: Drag Source & Drop Zone Discovery (snapshot.dragDrop)
# ════════════════════════════════════════════════════════════════════════
print("--- Item 17: Drag Source & Drop Zone Discovery ---")
if snap and isinstance(snap, dict):
    dd = snap.get("dragDrop")
    if dd and isinstance(dd, dict):
        count = dd.get("count", {})
        sources = dd.get("dragSources", [])
        zones = dd.get("dropZones", [])
        results[17] = True
        print(f"  [PASS] 17: dragDrop in snapshot")
        print(f"         count={json.dumps(count)}, byOrigin={json.dumps(dd.get('byOrigin', {}))}")
        if sources:
            print(f"         sources[0]: {t(sources[0], 200)}")
        if zones:
            print(f"         zones[0]: {t(zones[0], 200)}")
    else:
        results[17] = False
        print(f"  [FAIL] 17: 'dragDrop' not in snapshot or null")
else:
    results[17] = False

# ═══════════════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════════════
print()
print("=" * 70)
print("SUMMARY")
print("=" * 70)

NAMES = {
    2: "Loading/Pending State Detection",
    3: "Console Error/Warning Capture",
    4: "Element Change Diffing",
    5: "Page/Route Awareness",
    6: "Form State Awareness",
    7: "Modal/Dialog Stack",
    8: "Notification/Toast Detection",
    9: "Keyboard Shortcut Discovery",
    10: "Scroll Position / Overflow",
    11: "Element Relationship Hints",
    12: "Network Request Monitoring",
    13: "Screenshot/Visual Snapshot",
    14: "Fuzzy Element Matching",
    15: "Undo/Redo Awareness",
    16: "Clipboard Integration",
    17: "Drag & Drop Discovery",
}

items = sorted(k for k in results if isinstance(k, int))
passed = [i for i in items if results[i]]
failed = [i for i in items if not results[i]]

for i in items:
    tag = "PASS" if results[i] else "FAIL"
    print(f"  [{tag}] Item {i:2d}: {NAMES.get(i, '?')}")

print(f"\n  {len(passed)}/{len(items)} passed")
if failed:
    print(f"  Failed: {failed}")
