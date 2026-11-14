"""Step 1: turn the biologists' table + FAO salinity table into clean numeric crop parameters.

Run `python crops.py` to write crop_params.csv (handy to inspect).
Every number you may want to change is in the EDITABLE section right below.
"""
import re

import numpy as np
import pandas as pd

from config import DATA_DIR, find_file

# ======================= EDITABLE NUMBERS & ASSUMPTIONS =======================
# Growing cycle length in days. ASSUMPTIONS (approximate), not from the table.
CYCLE_DAYS = {"melon": 100, "strawberry": 240, "tomato": 130, "green bean": 110,
              "radish": 65, "sea asparagus": 150}  # radish 65: FAO EcoCrop
PERENNIALS = ["orange", "olive", "lemon", "blueberry"]   # evaluated over a whole year
PERENNIAL_CYCLE_DAYS = 365
DEFAULT_CYCLE_DAYS = 120          # ASSUMPTION for a crop not listed above
DEFAULT_WATER_MM = 500            # ASSUMPTION when the table has no water need
DEFAULT_SALT_SLOPE = 12           # ASSUMPTION (% yield lost per dS/m) when FAO has no value
DEFAULT_SALT_THRESHOLD = 4.0      # ASSUMPTION when nobody gives a threshold (olive: FAO 'moderately tolerant')
G_PER_L_PER_DSM = 0.64            # ~0.64 g/L of salt per 1 dS/m (to convert g/L -> dS/m)
# Change any single value after parsing, e.g. {"tomato": {"t_opt_min": 17}}
MANUAL_OVERRIDES = {
    "radish": {"t_opt_min": 12, "t_opt_max": 26},   # FAO EcoCrop (table said 21-29)
    "orange": {"t_opt_min": 20, "t_opt_max": 30},   # FAO EcoCrop (table said 25-30)
}

# Different spellings that mean the same crop (all matched in lower case).
CROP_ALIASES = {
    "sea asparagus": ["sea asparagus", "salicornia", "samphire"],
    "green bean": ["green bean", "bean"],
    "strawberry": ["strawberr"],
    "blueberry": ["blueberr"],
    "tomato": ["tomato"], "melon": ["melon"], "radish": ["radish"],
    "orange": ["orange"], "olive": ["olive"], "lemon": ["lemon"],
}
# ==============================================================================

MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]


def canonical(name):
    """Map any spelling ('Sea Asparagus (Salicornia)') to one key ('sea asparagus')."""
    low = str(name).lower().strip()
    for key, aliases in CROP_ALIASES.items():
        if any(a in low for a in aliases):
            return key
    return low


def numbers(text):
    """All numbers in a text, e.g. '18-30 °C' -> [18.0, 30.0]."""
    text = re.sub(r"(?<=\d),(?=\d{3})", "", str(text))  # "1,200" -> "1200"
    return [float(x) for x in re.findall(r"\d+(?:\.\d+)?", text)]


def find_col(df, *keywords):
    """First column whose name contains any keyword (case-insensitive), else None."""
    for col in df.columns:
        if any(k in col.lower() for k in keywords):
            return col
    return None


def planting_months(text):
    """Months listed after 'Plant' in the Grow Months text. 'Sep-Mar' -> [9..12, 1..3]."""
    low = str(text).lower()
    if "plant" in low:  # keep only the planting part, cut off the harvest part
        low = re.split(r"harvest|;|\|", low.split("plant", 1)[1])[0]
    pattern = r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?"
    found = re.findall(pattern + r"(?:\s*(?:-|–|to)\s*" + pattern + ")?", low)
    months = []
    for start, end in found:
        a = MONTHS.index(start) + 1
        b = MONTHS.index(end) + 1 if end else a
        m = a
        while True:  # walk forward, wrapping Dec -> Jan
            months.append(m)
            if m == b:
                break
            m = m % 12 + 1
    return sorted(set(months))


def load_crops():
    """Return a DataFrame (one row per crop) with clean numeric parameters."""
    bio = pd.read_csv(find_file("Biology*.csv"))
    fao = pd.read_csv(find_file("crops_extra.csv"))

    # Columns are found by keyword so small renames in the sheet do not break anything.
    c_crop = find_col(bio, "crop", "name", "plant")
    c_temp = find_col(bio, "temp")
    c_water = find_col(bio, "water", "irrig")  # season water need (NOT Rainfall)
    c_salt = find_col(bio, "salin")
    c_grow = find_col(bio, "grow month", "grow")
    f_crop = find_col(fao, "crop", "name")
    f_thr = find_col(fao, "thresh")
    f_slope = find_col(fao, "slope")

    fao_by_crop = {canonical(r[f_crop]): r for _, r in fao.iterrows()}
    rows = []
    for _, r in bio.iterrows():
        if pd.isna(r[c_crop]):
            continue
        key = canonical(r[c_crop])
        notes = []

        # Temperature optimum: '18-30 °C' -> 18, 30
        t = numbers(r[c_temp])
        t_min, t_max = (t[0], t[-1]) if t else (np.nan, np.nan)

        # Water need for the season: midpoint of the range. Missing -> default (assumed).
        w = numbers(r[c_water])
        if re.search(r"\d\s*cm", str(r[c_water])):
            w = [x * 10 for x in w]  # cm -> mm
        water_assumed = not w
        water = DEFAULT_WATER_MM if water_assumed else (w[0] + w[-1]) / 2
        if water_assumed:
            notes.append(f"water need assumed {DEFAULT_WATER_MM} mm")

        # Salinity: FAO threshold + slope. Biologists' '<4' is where yield drops A LOT,
        # so it is only a fallback threshold when FAO has no value.
        # Cells can hold text like '1.0 (P. vulgaris)' or 'n/a' -> take the first number.
        f = fao_by_crop.get(key)
        f_t = numbers(f[f_thr]) if f is not None else []
        f_s = numbers(f[f_slope]) if f is not None else []
        has_fao = bool(f_t and f_s)
        if has_fao:
            thr, slope = f_t[0], f_s[0]
        else:
            s = numbers(r[c_salt])
            if "g/l" in str(r[c_salt]).lower():
                s = [x / G_PER_L_PER_DSM for x in s]  # salt in g/L -> dS/m
            thr, slope = (s[0] if s else DEFAULT_SALT_THRESHOLD), DEFAULT_SALT_SLOPE
            source = "biologists' table" if s else f"default {DEFAULT_SALT_THRESHOLD} dS/m"
            notes.append(f"salinity threshold from {source}, slope {DEFAULT_SALT_SLOPE} assumed")

        # Planting window + cycle length. Perennials: whole year.
        perennial = key in PERENNIALS
        if perennial:
            months, cycle = list(range(1, 13)), PERENNIAL_CYCLE_DAYS
        else:
            months = planting_months(r[c_grow]) or list(range(1, 13))
            cycle = CYCLE_DAYS.get(key, DEFAULT_CYCLE_DAYS)
        notes.append(f"cycle {cycle} d assumed")

        rows.append({
            "crop": key, "display_name": key.capitalize(),
            "t_opt_min": t_min, "t_opt_max": t_max, "water_need_mm": water,
            "ece_threshold": thr, "ece_slope": slope,
            "plant_months": months, "cycle_days": cycle, "perennial": perennial,
            "assumed": water_assumed or not has_fao, "cycle_assumed": True,
            "notes": "; ".join(notes),
        })

    crops = pd.DataFrame(rows).set_index("crop", drop=False)
    # Extra parameters the biologists' table does not have (GDD, Kc, roots, pH), with sources:
    # data/crop_params_extra.csv (see data/CROP_PARAMS_EXTRA.md)
    extra = pd.read_csv(DATA_DIR / "crop_params_extra.csv").set_index("crop")
    extra = extra.drop(columns=["source", "confidence"])
    crops = crops.join(extra)
    for crop, changes in MANUAL_OVERRIDES.items():  # your manual edits win
        for field, value in changes.items():
            crops.at[crop, field] = value
    return crops


if __name__ == "__main__":
    table = load_crops()
    table.to_csv(DATA_DIR / "crop_params.csv", index=False)
    print(table.drop(columns=["display_name", "notes"]).to_string(index=False))
