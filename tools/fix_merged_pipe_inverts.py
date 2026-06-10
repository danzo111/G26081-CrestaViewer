"""
For the 8 pipes converted to real-real by the dummy merge, inherit invert
levels from the connected manholes (pipe end depth = manhole depth, so
pipe invert = manhole invert) and set diameters matched from the survey sheet.

Exception: if a connected manhole has no valid depth (blocked / depth 0),
keep the pipe's existing depth at that end rather than pinning it to cover
level (which would create a false uphill).

Run with --write to apply (.backup.json made). Without it, dry run only.
"""
import json, sys, shutil

NET = 'data/network.json'
WRITE = '--write' in sys.argv

# diameter matched from sheet OUT(upstream)/IN(downstream) stubs;
# note flags low-confidence matches.
SPEC = {
    'P272': {'dia': 300, 'note': 'SW144 OUT 300 = SW145 IN 300'},
    'P273': {'dia': 300, 'note': 'SW141 OUT 300 = SW144 IN 300'},
    'P278': {'dia': 300, 'note': 'SW151 OUT 300 = SW150 IN 300'},
    'P279': {'dia': 300, 'note': 'SW157 OUT 300; SW159 blocked (assumed 300)'},
    'P284': {'dia': 550, 'note': 'SW152 OUT 550 = SW153 IN 550'},
    'P287': {'dia': 600, 'note': 'SW145 OUT 600 = SW146 IN 600'},
    'P304': {'dia': 700, 'note': 'SW146 OUT 700 but SW152 IN recorded 550 - VERIFY'},
    'P369': {'dia': 600, 'note': 'SW130 OUT 600 (was guessed 400)'},
}

net = json.load(open(NET))
mh = {m['id']: m for m in net['manholes']}

def depth(mid):
    return mh[mid].get('depth')

def cover(mid):
    return mh[mid].get('cover_elev')

print(f'{"pipe":6}{"flow":16}{"dia":>10}   invert changes')
changes = []
for p in net['pipes']:
    if p['id'] not in SPEC:
        continue
    s = SPEC[p['id']]
    f, t = p['from_mh'], p['to_mh']
    old = (p.get('from_depth'), p.get('to_depth'), p.get('diameter_mm'))

    # inherit MH depth unless MH depth is missing/zero (blocked)
    fd = depth(f)
    nf = fd if (fd is not None and fd > 0) else p.get('from_depth')
    td = depth(t)
    nt = td if (td is not None and td > 0) else p.get('to_depth')

    fi = cover(f) - (nf or 0)
    ti = cover(t) - (nt or 0)
    fall = fi - ti
    flag = '  <-- UPHILL' if fall < -0.005 else ''
    kept_from = '' if (fd and fd > 0) else ' (kept-blocked)'
    kept_to = '' if (td and td > 0) else ' (kept-blocked)'

    print(f'{p["id"]:6}{f+"->"+t:16}{s["dia"]:>7}mm   '
          f'{f} IL {fi:.3f}{kept_from}, {t} IL {ti:.3f}{kept_to}  fall {fall:+.3f}m{flag}')
    print(f'        {s["note"]}')

    changes.append((p, nf, nt, s['dia'], old))

if WRITE:
    shutil.copy(NET, NET + '.backup.json')
    for p, nf, nt, dia, old in changes:
        p['from_depth'] = nf
        p['to_depth'] = nt
        p['diameter_mm'] = float(dia)
        p['diameter_source'] = 'survey_sheet_match'
    json.dump(net, open(NET, 'w'), indent=2)
    print(f'\nWROTE {NET} (backup at {NET}.backup.json)')
else:
    print('\n[DRY RUN] re-run with --write to apply.')
