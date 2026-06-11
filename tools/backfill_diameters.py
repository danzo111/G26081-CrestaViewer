"""
Backfill diameters for dgn_unsized pipes from the survey sheet pipe-size stubs.

Sheet: under each manhole, stub rows carry a pipe size and direction
(col H = size IN, col I = size OUT, or parsed from code 'P<size>IN/OUT').
A pipe A(upstream)->B(downstream) leaves A (A's OUT size) and enters B
(B's IN size). Matching priority:
  1. both ends real & OUT(A) n IN(B) has exactly one size  -> high conf
  2. from_mh real & A has exactly one OUT size              -> from outlet
  3. to_mh real   & B has exactly one IN size               -> to inlet
  4. non-empty intersection (>1) -> take it, flag ambiguous
Dummy/dummy pipes have no sheet data -> left unsized.

Run with --write to apply (.backup.json). Dry run otherwise.
"""
import openpyxl, re, json, sys, shutil
from collections import defaultdict, Counter

SHEET = r"G:\Shared drives\2026 Work\G26081 Cresta Wet Services\G26081 Working\Do Not Use\Daniel\G26081 20260522-29 Combined Levels.xlsx"
NET = r"C:\Users\User\Documents\GitHub\G26081 CrestaViwer\data\network.json"
WRITE = "--write" in sys.argv

def norm(mid):
    m = re.match(r"^([A-Za-z]+)(\d+)$", mid)
    return f"{m.group(1).upper()}{int(m.group(2))}" if m else mid.upper()

# ── parse sheet stubs per manhole ───────────────────────────────────────────
ID_RE = re.compile(r"^([A-Za-z]+\d+)")
ALPHA = re.compile(r"^([A-Za-z]+)")
ALLOWED = {"SE", "SW", "UK", "WMH", "W"}
def parse_mh(cs):
    m = ID_RE.match(cs)
    if not m or cs[m.end():m.end()+1] == ".":
        return None
    if ALPHA.match(m.group(1)).group(1).upper() not in ALLOWED:
        return None
    return m.group(1).upper()

ws = openpyxl.load_workbook(SHEET, read_only=True, data_only=True)["Sheet1"]
rows = list(ws.iter_rows(values_only=True))
stubs = defaultdict(lambda: {"in": set(), "out": set()})
cur = None
for r in rows[1:]:
    name, y, x, cover, code, inv, dep, sin, sout = (r + (None,)*12)[:9]
    if not code:
        continue
    cs = str(code).strip()
    if isinstance(cover, (int, float)):       # main manhole row
        cur = parse_mh(cs)
        continue
    if cur is None:
        continue
    up = cs.upper()
    msz = re.search(r"(\d{2,4})\s*(IN|OUT)", up)
    size = None
    if isinstance(sin, (int, float)): size = int(sin)
    elif isinstance(sout, (int, float)): size = int(sout)
    elif msz: size = int(msz.group(1))
    if size is None:
        continue
    if "OUT" in up:
        stubs[norm(cur)]["out"].add(size)
    elif "IN" in up:
        stubs[norm(cur)]["in"].add(size)

print(f"manholes with stub sizes in sheet: {len(stubs)}")

# ── match each unsized pipe ─────────────────────────────────────────────────
net = json.load(open(NET))
mhids = {m["id"] for m in net["manholes"]}
def real(mid):
    return mid in mhids and not mid.startswith("DUMMY")

unsized = [p for p in net["pipes"] if p.get("diameter_source") == "dgn_unsized"]
print(f"unsized pipes: {len(unsized)}\n")

def out_of(mid):
    return stubs.get(norm(mid), {}).get("out", set()) if real(mid) else set()
def in_of(mid):
    return stubs.get(norm(mid), {}).get("in", set()) if real(mid) else set()

results = Counter()
changes = []
for p in unsized:
    a, b = p["from_mh"], p["to_mh"]        # a = upstream, b = downstream
    oa, ib = out_of(a), in_of(b)
    dia = None; src = None
    inter = oa & ib
    if real(a) and real(b) and len(inter) == 1:
        dia = next(iter(inter)); src = "sheet_both"
    elif real(a) and len(oa) == 1:
        dia = next(iter(oa)); src = "sheet_from_out"
    elif real(b) and len(ib) == 1:
        dia = next(iter(ib)); src = "sheet_to_in"
    elif len(inter) >= 1:
        dia = max(inter); src = "sheet_ambiguous"
    elif real(a) and oa:
        dia = max(oa); src = "sheet_from_ambig"
    elif real(b) and ib:
        dia = max(ib); src = "sheet_to_ambig"
    if dia is not None:
        results[src] += 1
        changes.append((p, float(dia), src))
    else:
        results["unmatched"] += 1
        if not real(a) or not real(b):
            results["_u_dummy_end"] += 1
        else:
            results["_u_real_no_sheet"] += 1

print("match results:")
for k, v in results.most_common():
    if k.startswith("_"):
        continue
    print(f"   {k:18}: {v}")
print(f"   unmatched breakdown -> dummy-end: {results['_u_dummy_end']}, "
      f"real-but-not-in-sheet: {results['_u_real_no_sheet']}")
matched = sum(v for k, v in results.items() if k != "unmatched" and not k.startswith("_"))
print(f"\n   TOTAL matched: {matched} / {len(unsized)}")

# show a sample
print("\nsample matches:")
for p, dia, src in changes[:20]:
    print(f"   {p['id']}: {p['from_mh']:8}->{p['to_mh']:8} = {dia:.0f}mm ({src})")

if WRITE:
    shutil.copy(NET, NET + ".backup.json")
    for p, dia, src in changes:
        p["diameter_mm"] = dia
        p["diameter_source"] = src
    json.dump(net, open(NET, "w"), indent=2)
    print(f"\nWROTE {NET} (backup at {NET}.backup.json)")
    still = sum(1 for p in net["pipes"] if p.get("diameter_source") == "dgn_unsized")
    print(f"  still unsized: {still}")
else:
    print("\n[DRY RUN] re-run with --write to apply.")
