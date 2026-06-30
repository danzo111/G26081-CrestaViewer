"""Client-facing render: network coloured by utility type over the aerial basemap."""
import json, math
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
import numpy as np

net = json.load(open("data/network.json"))
mh = {m["id"]: m for m in net["manholes"]}
md = net["metadata"]; bb = md["basemap_bounds"]

PIPE = {"Sewer": "#E87722", "Stormwater": "#2E9BD6", "Water": "#0A3D91", "Unknown": "#9aa7b3"}
MHC  = {"Sewer": "#E87722", "Stormwater": "#00C8FF", "Water": "#0A3D91", "Unknown": "#cfd8e0"}

def pipe_pts(p):
    A, B = mh.get(p["from_mh"]), mh.get(p["to_mh"])
    if not A or not B: return None
    if p.get("path") and len(p["path"]) >= 2: return [(xy[0], xy[1]) for xy in p["path"]]
    return [(A["x"], A["y"]), (B["x"], B["y"])]

fig, ax = plt.subplots(figsize=(17, 18.5), dpi=140)
ax.set_facecolor("#0D1E35")
# basemap (rotate 180 per metadata)
try:
    img = plt.imread("basemap.png")
    if md.get("rotate_180"): img = img[::-1, ::-1]
    ax.imshow(img, extent=[bb["left"], bb["right"], bb["bottom"], bb["top"]],
              origin="upper", alpha=0.55, zorder=0)
except Exception as e:
    print("basemap skipped:", e)

# pipes by type
for p in net["pipes"]:
    pts = pipe_pts(p)
    if not pts: continue
    ax.plot([x for x, y in pts], [y for x, y in pts],
            color=PIPE.get(p.get("type"), "#9aa7b3"), lw=1.6, alpha=0.95, zorder=2,
            solid_capstyle="round")
# manholes (skip dummies)
for i, m in mh.items():
    if i.startswith("DUMMY"): continue
    ax.plot(m["x"], m["y"], "o", ms=5, color=MHC.get(m["type"], "#ccc"),
            mec="white", mew=0.6, zorder=4)

ax.set_xlim(bb["left"], bb["right"]); ax.set_ylim(bb["bottom"], bb["top"])
ax.set_aspect("equal"); ax.axis("off")
ax.set_title(f"{md.get('project','Network')} — Stormwater & Sewer GIS Network",
             color="white", fontsize=17, pad=12)
n_mh = sum(1 for i in mh if not i.startswith("DUMMY"))
n_pipe = len(net["pipes"])
ax.text(0.01, 0.01, f"{n_mh} manholes · {n_pipe} pipes", transform=ax.transAxes,
        color="#cfd8e0", fontsize=11, va="bottom")
leg = [Line2D([0],[0],color=PIPE["Sewer"],lw=3,label="Sewer pipe"),
       Line2D([0],[0],color=PIPE["Stormwater"],lw=3,label="Stormwater pipe"),
       Line2D([0],[0],color=PIPE["Water"],lw=3,label="Water pipe"),
       Line2D([0],[0],marker="o",color=MHC["Sewer"],lw=0,label="Sewer MH",mec="w"),
       Line2D([0],[0],marker="o",color=MHC["Stormwater"],lw=0,label="Stormwater MH",mec="w"),
       Line2D([0],[0],marker="o",color=MHC["Water"],lw=0,label="Water MH",mec="w")]
ax.legend(handles=leg, loc="upper right", fontsize=10, facecolor="#162B47",
          labelcolor="white", framealpha=0.92)
fig.tight_layout(); fig.savefig("tools/client_network.png", facecolor="#0D1E35", bbox_inches="tight")
print("wrote tools/client_network.png")
