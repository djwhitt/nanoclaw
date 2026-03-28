---
name: periodic-table
description: Generate periodic table images with GNUPlot. Highlight elements by symbol, category, or custom criteria for quizzes and tutorials.
allowed-tools: Bash(gnuplot:*) Bash(python3:*)
---

# Periodic Table Generator

Render publication-quality periodic table PNGs using Python + GNUPlot. A single Python script contains all 118 elements inline, applies highlights, and emits a fully-expanded GNUPlot script — then GNUPlot renders it in one shot.

## Workflow

1. Write the Python script to `/tmp/periodic_table.py` (contains all element data inline)
2. Run `python3 /tmp/periodic_table.py` with arguments to produce `/tmp/periodic_table.gp`
3. Run `gnuplot /tmp/periodic_table.gp` to produce `/tmp/periodic_table.png`
4. Send via `mcp__nanoclaw__send_file`

## Python Script

Write this to `/tmp/periodic_table.py`. It contains all element data, applies highlights, and writes a fully-expanded GNUPlot script with all `set object`/`set label` commands pre-computed — no GNUPlot loops or subprocess calls.

```python
#!/usr/bin/env python3
"""Generate a GNUPlot script for a periodic table with optional highlights."""
import sys
import json

# --- All 118 elements: (Z, Symbol, Name, Category, Col, Row) ---
# Category codes: AM=Alkali Metal, AEM=Alkaline Earth Metal, TM=Transition Metal,
# PTM=Post-Transition Metal, M=Metalloid, RNM=Reactive Nonmetal, NG=Noble Gas,
# L=Lanthanide, A=Actinide, UK=Unknown
# Col=x grid position (1-18), Row=y grid position (1-7 main, 9=lanthanides, 10=actinides)
ELEMENTS = [
    (1,"H","Hydrogen","RNM",1,1),(2,"He","Helium","NG",18,1),
    (3,"Li","Lithium","AM",1,2),(4,"Be","Beryllium","AEM",2,2),
    (5,"B","Boron","M",13,2),(6,"C","Carbon","RNM",14,2),
    (7,"N","Nitrogen","RNM",15,2),(8,"O","Oxygen","RNM",16,2),
    (9,"F","Fluorine","RNM",17,2),(10,"Ne","Neon","NG",18,2),
    (11,"Na","Sodium","AM",1,3),(12,"Mg","Magnesium","AEM",2,3),
    (13,"Al","Aluminium","PTM",13,3),(14,"Si","Silicon","M",14,3),
    (15,"P","Phosphorus","RNM",15,3),(16,"S","Sulfur","RNM",16,3),
    (17,"Cl","Chlorine","RNM",17,3),(18,"Ar","Argon","NG",18,3),
    (19,"K","Potassium","AM",1,4),(20,"Ca","Calcium","AEM",2,4),
    (21,"Sc","Scandium","TM",3,4),(22,"Ti","Titanium","TM",4,4),
    (23,"V","Vanadium","TM",5,4),(24,"Cr","Chromium","TM",6,4),
    (25,"Mn","Manganese","TM",7,4),(26,"Fe","Iron","TM",8,4),
    (27,"Co","Cobalt","TM",9,4),(28,"Ni","Nickel","TM",10,4),
    (29,"Cu","Copper","TM",11,4),(30,"Zn","Zinc","TM",12,4),
    (31,"Ga","Gallium","PTM",13,4),(32,"Ge","Germanium","M",14,4),
    (33,"As","Arsenic","M",15,4),(34,"Se","Selenium","RNM",16,4),
    (35,"Br","Bromine","RNM",17,4),(36,"Kr","Krypton","NG",18,4),
    (37,"Rb","Rubidium","AM",1,5),(38,"Sr","Strontium","AEM",2,5),
    (39,"Y","Yttrium","TM",3,5),(40,"Zr","Zirconium","TM",4,5),
    (41,"Nb","Niobium","TM",5,5),(42,"Mo","Molybdenum","TM",6,5),
    (43,"Tc","Technetium","TM",7,5),(44,"Ru","Ruthenium","TM",8,5),
    (45,"Rh","Rhodium","TM",9,5),(46,"Pd","Palladium","TM",10,5),
    (47,"Ag","Silver","TM",11,5),(48,"Cd","Cadmium","TM",12,5),
    (49,"In","Indium","PTM",13,5),(50,"Sn","Tin","PTM",14,5),
    (51,"Sb","Antimony","M",15,5),(52,"Te","Tellurium","M",16,5),
    (53,"I","Iodine","RNM",17,5),(54,"Xe","Xenon","NG",18,5),
    (55,"Cs","Caesium","AM",1,6),(56,"Ba","Barium","AEM",2,6),
    (57,"La","Lanthanum","L",3,9),(58,"Ce","Cerium","L",4,9),
    (59,"Pr","Praseodymium","L",5,9),(60,"Nd","Neodymium","L",6,9),
    (61,"Pm","Promethium","L",7,9),(62,"Sm","Samarium","L",8,9),
    (63,"Eu","Europium","L",9,9),(64,"Gd","Gadolinium","L",10,9),
    (65,"Tb","Terbium","L",11,9),(66,"Dy","Dysprosium","L",12,9),
    (67,"Ho","Holmium","L",13,9),(68,"Er","Erbium","L",14,9),
    (69,"Tm","Thulium","L",15,9),(70,"Yb","Ytterbium","L",16,9),
    (71,"Lu","Lutetium","L",17,9),(72,"Hf","Hafnium","TM",4,6),
    (73,"Ta","Tantalum","TM",5,6),(74,"W","Tungsten","TM",6,6),
    (75,"Re","Rhenium","TM",7,6),(76,"Os","Osmium","TM",8,6),
    (77,"Ir","Iridium","TM",9,6),(78,"Pt","Platinum","TM",10,6),
    (79,"Au","Gold","TM",11,6),(80,"Hg","Mercury","TM",12,6),
    (81,"Tl","Thallium","PTM",13,6),(82,"Pb","Lead","PTM",14,6),
    (83,"Bi","Bismuth","PTM",15,6),(84,"Po","Polonium","PTM",16,6),
    (85,"At","Astatine","M",17,6),(86,"Rn","Radon","NG",18,6),
    (87,"Fr","Francium","AM",1,7),(88,"Ra","Radium","AEM",2,7),
    (89,"Ac","Actinium","A",3,10),(90,"Th","Thorium","A",4,10),
    (91,"Pa","Protactinium","A",5,10),(92,"U","Uranium","A",6,10),
    (93,"Np","Neptunium","A",7,10),(94,"Pu","Plutonium","A",8,10),
    (95,"Am","Americium","A",9,10),(96,"Cm","Curium","A",10,10),
    (97,"Bk","Berkelium","A",11,10),(98,"Cf","Californium","A",12,10),
    (99,"Es","Einsteinium","A",13,10),(100,"Fm","Fermium","A",14,10),
    (101,"Md","Mendelevium","A",15,10),(102,"No","Nobelium","A",16,10),
    (103,"Lr","Lawrencium","A",17,10),(104,"Rf","Rutherfordium","TM",4,7),
    (105,"Db","Dubnium","TM",5,7),(106,"Sg","Seaborgium","TM",6,7),
    (107,"Bh","Bohrium","TM",7,7),(108,"Hs","Hassium","TM",8,7),
    (109,"Mt","Meitnerium","UK",9,7),(110,"Ds","Darmstadtium","UK",10,7),
    (111,"Rg","Roentgenium","UK",11,7),(112,"Cn","Copernicium","UK",12,7),
    (113,"Nh","Nihonium","UK",13,7),(114,"Fl","Flerovium","UK",14,7),
    (115,"Mc","Moscovium","UK",15,7),(116,"Lv","Livermorium","UK",16,7),
    (117,"Ts","Tennessine","UK",17,7),(118,"Og","Oganesson","UK",18,7),
]

# --- Parse arguments ---
# Usage: python3 periodic_table.py [OPTIONS]
#   --title "Title Text"
#   --highlight "He,Ne,Ar,Kr,Xe,Rn,Og" --highlight-color "#FFD700"
#   --highlight2 "Li,Na,K" --highlight2-color "#FF4444"
#   --output /tmp/periodic_table.png
#   --size 1800,1000
#   --opacity 0.6
#   --category-colors '{"NG":"#FFD700"}'   (override default category colors)

args = sys.argv[1:]

def get_arg(flag, default=None):
    if flag in args:
        idx = args.index(flag)
        if idx + 1 < len(args):
            return args[idx + 1]
    return default

title = get_arg("--title", "Periodic Table of Elements")
highlight_str = get_arg("--highlight", "")
highlight_color = get_arg("--highlight-color", "#FFD700")
highlight2_str = get_arg("--highlight2", "")
highlight2_color = get_arg("--highlight2-color", "#FF4444")
output_path = get_arg("--output", "/tmp/periodic_table.png")
size = get_arg("--size", "1800,1000")
opacity = get_arg("--opacity", "0.6")
cat_overrides_json = get_arg("--category-colors", "{}")

highlights = set(s.strip() for s in highlight_str.split(",") if s.strip())
highlights2 = set(s.strip() for s in highlight2_str.split(",") if s.strip())
cat_overrides = json.loads(cat_overrides_json)

# --- Category colors ---
CAT_COLORS = {
    "AM":  "#FF6666", "AEM": "#FFDEAD", "TM":  "#FFB366",
    "PTM": "#99CC99", "M":   "#66CCCC", "RNM": "#77DD77",
    "NG":  "#99BBFF", "L":   "#FFAACC", "A":   "#DD99FF",
    "UK":  "#CCCCCC",
}
CAT_COLORS.update(cat_overrides)

CAT_LABELS = [
    ("AM", "Alkali Metal"), ("AEM", "Alkaline Earth"), ("TM", "Transition Metal"),
    ("PTM", "Post-Trans. Metal"), ("M", "Metalloid"), ("RNM", "Reactive Nonmetal"),
    ("NG", "Noble Gas"), ("L", "Lanthanide"), ("A", "Actinide"), ("UK", "Unknown"),
]

def row_to_y(row):
    if row <= 7:
        return 8 - row       # rows 1-7 → y 7 down to 1
    return -0.5 if row == 9 else -1.5  # f-block below main table with gap

# --- Build GNUPlot script ---
lines = []
w, h = size.split(",")
lines.append(f'set terminal pngcairo size {w},{h} font "Sans,11" enhanced')
lines.append(f"set output '{output_path}'")
lines.append(f'set title "{title}" font "Sans Bold,16" offset 0,-0.5')
lines.append("set xrange [-0.5:19.0]")
lines.append("set yrange [-2.3:11.2]")
lines.append("set size ratio 0.65")
lines.append("unset border; unset tics; unset key")
lines.append("set margins 1, 1, 1, 2")

# Legend: two rows of category labels with colored swatches
lx, ly = 3.4, 10.7
for i, (cat, label) in enumerate(CAT_LABELS):
    row_off = 0 if i < 7 else -0.4
    col_off = (i % 7) * 2.2
    sx = round(lx + col_off, 2)
    sy = round(ly + row_off, 2)
    # Small colored rectangle as swatch
    lines.append(
        f'set object {500+i} rect from {sx-0.15:.2f},{sy-0.08:.2f} to {sx+0.05:.2f},{sy+0.12:.2f} '
        f'fc rgb "{CAT_COLORS[cat]}" fs solid 0.8 front'
    )
    lines.append(
        f'set label {1001+i} "{label}" at {sx+0.15:.2f},{sy:.2f} '
        f'font "Sans,8" tc rgb "#333333"'
    )
if highlights:
    sx, sy = round(lx + 3 * 2.2, 2), round(ly - 0.4, 2)
    lines.append(
        f'set object 510 rect from {sx-0.15:.2f},{sy-0.08:.2f} to {sx+0.05:.2f},{sy+0.12:.2f} '
        f'fc rgb "{highlight_color}" fs solid 0.8 front'
    )
    lines.append(
        f'set label 1011 "Highlighted" at {sx+0.15:.2f},{sy:.2f} '
        f'font "Sans,8" tc rgb "#333333"'
    )
if highlights2:
    sx, sy = round(lx + 4 * 2.2, 2), round(ly - 0.4, 2)
    lines.append(
        f'set object 511 rect from {sx-0.15:.2f},{sy-0.08:.2f} to {sx+0.05:.2f},{sy+0.12:.2f} '
        f'fc rgb "{highlight2_color}" fs solid 0.8 front'
    )
    lines.append(
        f'set label 1012 "Highlighted 2" at {sx+0.15:.2f},{sy:.2f} '
        f'font "Sans,8" tc rgb "#333333"'
    )

# Period labels (1-7) on the left, outside the table
lines.append('set label 2099 "Period" at -0.35,4 center rotate by 90 font "Sans Italic,9" tc rgb "#666666"')
for p in range(1, 8):
    y = 8 - p
    lines.append(f'set label {2100+p} "{p}" at 0.0,{y} center font "Sans,9" tc rgb "#666666"')

# Group labels (1-18) across the top
lines.append('set label 2199 "Group" at 9.5,8.2 center font "Sans Italic,9" tc rgb "#666666"')
for g in range(1, 19):
    lines.append(f'set label {2200+g} "{g}" at {g},7.7 center font "Sans,9" tc rgb "#666666"')

# f-block row labels and connector lines
lines.append('set style arrow 1 nohead lc rgb "#AAAAAA" lw 0.5 dt 3')
lines.append('set arrow 1 from 3.0,0.5 to 3.0,0.0 as 1')
lines.append('set arrow 2 from 3.0,-1.0 to 3.0,-0.8 as 1')

# Element cells
for i, (z, sym, name, cat, col, row) in enumerate(ELEMENTS):
    x = float(col)
    y = row_to_y(row)

    # Determine color
    if sym in highlights:
        color = highlight_color
    elif sym in highlights2:
        color = highlight2_color
    else:
        color = CAT_COLORS.get(cat, "#CCCCCC")

    obj_id = i + 1
    lbl_z = 3000 + i * 2
    lbl_s = 3000 + i * 2 + 1

    lines.append(
        f'set object {obj_id} rect from {x-0.5},{y-0.5} to {x+0.5},{y+0.5} '
        f'fc rgb "{color}" fs solid {opacity} border rgb "#444444" lw 0.5'
    )
    lines.append(
        f'set label {lbl_z} "{z}" at {x-0.35},{y+0.3} font "Sans,7" tc rgb "#333333"'
    )
    lines.append(
        f'set label {lbl_s} "{sym}" at {x},{y-0.05} center font "Sans Bold,13" tc rgb "#000000"'
    )

lines.append("plot NaN notitle")

# --- Write output ---
with open("/tmp/periodic_table.gp", "w") as f:
    f.write("\n".join(lines) + "\n")

print(f"Wrote /tmp/periodic_table.gp ({len(ELEMENTS)} elements)")
```

## Quick Start

To generate a periodic table with noble gases highlighted:

```bash
python3 /tmp/periodic_table.py --title "Noble Gases" --highlight "He,Ne,Ar,Kr,Xe,Rn,Og" --highlight-color "#FFD700"
gnuplot /tmp/periodic_table.gp
# sends /tmp/periodic_table.png
```

## Command-Line Options

| Flag | Purpose | Default |
|------|---------|---------|
| `--title` | Title text above the table | `"Periodic Table of Elements"` |
| `--highlight` | Comma-separated symbols to highlight | _(none)_ |
| `--highlight-color` | Hex color for highlighted group | `#FFD700` (gold) |
| `--highlight2` | Second group of symbols | _(none)_ |
| `--highlight2-color` | Hex color for second group | `#FF4444` (red) |
| `--output` | PNG output path | `/tmp/periodic_table.png` |
| `--size` | Image dimensions `W,H` | `1800,1000` |
| `--opacity` | Cell fill opacity (0.0-1.0) | `0.6` |
| `--category-colors` | JSON overriding default category colors | `{}` |

## Examples

**Highlight noble gases:**
```bash
python3 /tmp/periodic_table.py --highlight "He,Ne,Ar,Kr,Xe,Rn,Og"
```

**Two highlight groups (organic + metals):**
```bash
python3 /tmp/periodic_table.py \
  --title "Biochemistry Elements" \
  --highlight "H,C,N,O,P,S" --highlight-color "#FF6644" \
  --highlight2 "Fe,Cu,Zn,Mn,Co" --highlight2-color "#4488FF"
```

**Override category colors (make all noble gases gold):**
```bash
python3 /tmp/periodic_table.py --category-colors '{"NG":"#FFD700"}'
```

**Blank gray table:**
```bash
python3 /tmp/periodic_table.py \
  --category-colors '{"AM":"#CCC","AEM":"#CCC","TM":"#CCC","PTM":"#CCC","M":"#CCC","RNM":"#CCC","NG":"#CCC","L":"#CCC","A":"#CCC","UK":"#CCC"}'
```

**Smaller image for chat:**
```bash
python3 /tmp/periodic_table.py --size "1200,660"
```

## Element Data Reference

The 118 elements are embedded in the `ELEMENTS` list in the Python script above. Each tuple is `(Z, Symbol, Name, Category, Col, Row)` where Col/Row control grid position. Category codes:

| Code | Category |
|------|----------|
| `AM` | Alkali Metal |
| `AEM` | Alkaline Earth Metal |
| `TM` | Transition Metal |
| `PTM` | Post-Transition Metal |
| `M` | Metalloid |
| `RNM` | Reactive Nonmetal |
| `NG` | Noble Gas |
| `L` | Lanthanide |
| `A` | Actinide |
| `UK` | Unknown |

## Tips

- Output is 1800x1000 PNG by default -- good for chat and presentations
- The Python script runs in ~10ms and produces a flat GNUPlot script with no loops
- Increase `--opacity` to `1.0` for fully saturated cell colors
- The agent only needs to write ONE file (`periodic_table.py`) -- all element data is inline
