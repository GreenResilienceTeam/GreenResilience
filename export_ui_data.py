"""Export model results for the designed interface (ui/) -> data/ui_data.json

Runs scoring.py for every crop x zone x planting week x Field Shift step.
It only CALLS the model; every number in the UI comes from here.
Run:  python export_ui_data.py
"""
import json

import numpy as np

from config import DATA_DIR, SALINE_WATER_LABEL, SUMMER_MONTHS, ZONES, load_daily
from scoring import GOOD_SCORE, PH_REASON, SPECIAL_PENALTIES, get_crops, scan_year

DT_STEPS = [0, 1, 2, 3, 4]            # warming steps (C) offered by the UI slider
RAIN_STEPS = [60, 70, 80, 90, 100]    # rain steps (% of 2025)
SCALE = 10000                         # scores are stored as integers: 0.7543 -> 7543


def as_int(values):
    return [int(round(v * SCALE)) for v in values]


def precise(values):
    """Sub-scores keep 8 decimals so near-ties pick the same weakest factor as Python."""
    return [round(float(v), 8) for v in values]


def main():
    crops = get_crops()
    out = {"scale": SCALE, "dT": DT_STEPS, "rain": RAIN_STEPS, "summer_months": SUMMER_MONTHS,
           "good_score": GOOD_SCORE, "ph_reason": PH_REASON, "saline_label": SALINE_WATER_LABEL,
           "penalty": {c: f for c, (f, _) in SPECIAL_PENALTIES.items()},
           "cold": {}, "hot": {}, "salt_drop": {}, "uses_seawater": {}, "match_pct": {},
           "zones": [{"name": z, **v} for z, v in ZONES.items()],
           "crops": [], "weeks": None, "match": {}, "best": {}, "temp": {}, "yield": {},
           "salt": {}, "water": {}, "rain_mm": {}, "irrigation": {}, "warning": {}, "needs_saline": {}}

    for crop, p in crops.iterrows():
        out["crops"].append({
            "key": crop, "name": p["display_name"], "t_min": p["t_opt_min"], "t_max": p["t_opt_max"],
            "water_mm": p["water_need_mm"], "ece_threshold": p["ece_threshold"], "cycle_days": int(p["cycle_days"]),
            "months": [int(m) for m in p["plant_months"]], "perennial": bool(p["perennial"]),
            "assumed": bool(p["assumed"]), "notes": p["notes"]})
        for zone in ZONES:
            k = f"{crop}|{zone}"
            out["match"][k], out["best"][k], out["temp"][k], out["yield"][k] = [], [], [], []
            out["cold"][k], out["hot"][k], out["match_pct"][k] = [], [], []
            for dT in DT_STEPS:
                for rain in RAIN_STEPS:
                    df = scan_year(crop, zone, dT, rain / 100)
                    if out["weeks"] is None:
                        out["weeks"] = [str(d) for d in df["planting_date"]]
                    out["match"][k].append(as_int(df["match"]))
                    out["match_pct"][k].append([round(v * 100) for v in df["match"]])   # whole %, rounded by Python
                    # best planting date = same rule as scoring.best_planting (first max in allowed months)
                    allowed = df[df["in_planting_months"]]
                    out["best"][k].append(int(allowed["match"].idxmax()))
                    if rain == RAIN_STEPS[0]:   # temperature + yield only depend on dT (checked below)
                        out["temp"][k].append(precise(df["temp_score"]))
                        out["yield"][k].append([round(v, 2) for v in df["expected_yield_pct"]])
                        out["cold"][k].append([round(v) for v in df["cold_pct"]])   # Python rounding = same as the text
                        out["hot"][k].append([round(v) for v in df["hot_pct"]])
                    else:   # sanity check: same temperature score for every rain factor
                        stored = np.array(out["temp"][k][-1])
                        assert np.allclose(df["temp_score"], stored, atol=1e-4), (crop, zone, dT, rain)
                    if dT == 0 and zone == list(ZONES)[0]:   # water and rain only depend on rain factor
                        out["water"].setdefault(crop, []).append(precise(df["water_score"]))
                        out["rain_mm"].setdefault(crop, []).append([round(v) for v in df["rain_mm"]])
                        out["irrigation"].setdefault(crop, []).append([round(v) for v in df["irrigation_mm"]])
                    else:   # sanity check: same water score as stored for this rain factor
                        stored = np.array(out["water"][crop][RAIN_STEPS.index(rain)])
                        assert np.allclose(df["water_score"], stored, atol=1e-4), (crop, zone, dT, rain)
            out["salt"][k] = round(float(df["salt_score"].iloc[0]), 8)
            out["warning"][k] = df["warning"].iloc[0]
            out["needs_saline"][k] = bool(df["needs_saline"].iloc[0])
            out["uses_seawater"][k] = bool(df["uses_seawater"].iloc[0])
            out["salt_drop"][k] = round((1 - df["salt_score"].iloc[0]) * 100)
        print(f"exported {crop}")

    # NASA SMAP L4 daily series (for the climate charts, rainfall bars and soil moisture)
    daily = load_daily()
    out["daily"] = {"time": [str(t.date()) for t in daily["time"]],
                    "temp": [round(v, 2) for v in daily["temp_mean_C"]],
                    "precip": [round(v, 2) for v in daily["precip_mm"]],
                    "sm_rootzone": [round(v, 4) for v in daily["sm_rootzone"]]}
    path = DATA_DIR / "ui_data.json"
    path.write_text(json.dumps(out, separators=(",", ":")))
    print(f"Saved {path} ({path.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
