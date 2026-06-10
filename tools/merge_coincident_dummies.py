"""
Step 1: merge dummy manholes that sit exactly on top of a real manhole
(<= TOL metres) into that real manhole.

For each coincident dummy D -> real R:
  - every pipe endpoint referencing D is repointed to R
  - any other dummy whose parent_mh == D is repointed to R
  - D is removed from the manholes list
Pipes that collapse to a self-loop (from == to) after repointing are dropped
(they were zero-length dummy/real connectors).

Run with --write to apply (a .backup.json is made). Without it, dry run only.
"""
import json, math, sys, shutil

NET = 'data/network.json'
TOL = 0.2
WRITE = '--write' in sys.argv

net = json.load(open(NET))
manholes = net['manholes']
pipes = net['pipes']
mh = {m['id']: m for m in manholes}

reals = [m for m in manholes if m.get('type') != 'Dummy' and not m['id'].startswith('DUMMY')]
dums  = [m for m in manholes if m.get('type') == 'Dummy' or m['id'].startswith('DUMMY')]

def dist(a, b):
    return math.hypot(a['x'] - b['x'], a['y'] - b['y'])

# build coincident dummy -> real map
merge = {}
for d in dums:
    nr = min(reals, key=lambda r: dist(d, r))
    if dist(d, nr) <= TOL:
        merge[d['id']] = nr['id']

def isd(x):
    return x.startswith('DUMMY') or mh.get(x, {}).get('type') == 'Dummy'

# ── hydraulic helpers (real-real pipes only) ────────────────────────────────
def cov(mid, mapping):
    rid = mapping.get(mid, mid)
    return mh[rid].get('cover_elev') if rid in mh else None

def flow_issues(mapping):
    """uphill + mismatch issues over pipes that are real-real under `mapping`."""
    iss = set()
    for p in pipes:
        f = mapping.get(p['from_mh'], p['from_mh'])
        t = mapping.get(p['to_mh'], p['to_mh'])
        if f == t:
            continue
        if isd(f) or isd(t):
            continue
        fc, tc = mh[f].get('cover_elev'), mh[t].get('cover_elev')
        if fc is None or tc is None:
            continue
        fi = fc - (p.get('from_depth') or 0)
        ti = tc - (p.get('to_depth') or 0)
        if ti > fi + 0.005:
            iss.add(f'UPHILL {p["id"]} {f}->{t} (+{ti-fi:.3f}m)')
    return iss

identity = {}
before = flow_issues(identity)
after = flow_issues(merge)
new_uphill = sorted(after - before)

# ── report ───────────────────────────────────────────────────────────────────
print(f'Coincident dummies to merge (<= {TOL} m): {len(merge)}\n')
for d, r in sorted(merge.items()):
    print(f'  {d} -> {r}   (type {mh[r].get("type")}, dist {dist(mh[d], mh[r]):.3f} m)')

rewired, selfloops = [], []
for p in pipes:
    nf = merge.get(p['from_mh'], p['from_mh'])
    nt = merge.get(p['to_mh'], p['to_mh'])
    if nf == p['from_mh'] and nt == p['to_mh']:
        continue
    if nf == nt:
        selfloops.append((p['id'], p['from_mh'], p['to_mh']))
    else:
        rewired.append((p['id'], f'{p["from_mh"]}->{p["to_mh"]}', f'{nf}->{nt}'))

print(f'\nPipes repointed: {len(rewired)}')
for pid, old, new in rewired:
    tag = '   *real-real now*' if not (isd(new.split("->")[0]) or isd(new.split("->")[1])) else ''
    print(f'  {pid}: {old}  =>  {new}{tag}')

print(f'\nSelf-loop pipes to DROP (zero-length dummy/real connectors): {len(selfloops)}')
for pid, f, t in selfloops:
    print(f'  {pid}: {f}->{t}')

# parent_mh repointing
parent_fixes = [d['id'] for d in dums if d.get('parent_mh') in merge]
print(f'\nDummies whose parent_mh points at a merged dummy (repoint): {len(parent_fixes)}')
for pid in parent_fixes:
    print(f'  {pid}: parent {mh[pid]["parent_mh"]} -> {merge[mh[pid]["parent_mh"]]}')

print(f'\nHydraulic check (real-real uphill): before={len(before)} after={len(after)}')
if new_uphill:
    print('  NEW uphill surfaced by merge (data to verify, merge still valid):')
    for u in new_uphill:
        print(f'    ! {u}')
else:
    print('  no new uphill introduced.')

# ── write ──────────────────────────────────────────────────────────────────
if WRITE:
    shutil.copy(NET, NET + '.backup.json')
    drop_ids = {pid for pid, _, _ in selfloops}
    for p in pipes:
        p['from_mh'] = merge.get(p['from_mh'], p['from_mh'])
        p['to_mh'] = merge.get(p['to_mh'], p['to_mh'])
    net['pipes'] = [p for p in pipes if p['id'] not in drop_ids]
    for m in manholes:
        if m.get('parent_mh') in merge:
            m['parent_mh'] = merge[m['parent_mh']]
    net['manholes'] = [m for m in manholes if m['id'] not in merge]
    json.dump(net, open(NET, 'w'), indent=2)
    print(f'\nWROTE {NET} (backup at {NET}.backup.json)')
    print(f'  manholes: {len(net["manholes"])}  pipes: {len(net["pipes"])}')
else:
    print('\n[DRY RUN] re-run with --write to apply.')
