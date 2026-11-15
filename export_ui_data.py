"""Export model results for the designed interface (ui/) -> data/ui_data.json

Runs scoring.py for every crop x zone x planting week x Field Shift step.
It only CALLS the model; every number in the UI comes from here.
Run:  python export_ui_data.py
"""
import json

import pandas as pd

from config import DATA_DIR, SALINE_WATER_LABEL, SUMMER_MONTHS, YEARS, ZONES, load_daily
from scoring import ET0_PER_C, GOOD_SCORE, get_crops, load_siar, load_soil, scan_year

DT_STEPS = [0, 1, 2, 3, 4]            # warming steps (C) offered by the UI slider
RAIN_STEPS = [60, 70, 80, 90, 100]    # rain steps (% of the measured years)
SCALE = 1_000_000                     # sub-scores stored as integers with 6 decimals

# One row per planting week. Whole numbers are rounded by Python, exactly as in the text.
ROW = ["pct", "match", "temp", "water", "irr", "crop_water", "eff_rain", "soil_water", "rain", "cycle",
       "gdd", "extreme", "frost", "heat", "cold", "hot", "tmean10", "yld"] + [f"y{y}" for y in YEARS]


def encode(r):
    return [round(r["match"] * 100), round(r["match"] * SCALE), round(r["temp_score"] * SCALE),
            round(r["water_score"] * SCALE), round(r["irrigation_mm"]), round(r["crop_water_mm"]),
            round(r["eff_rain_mm"]), round(r["soil_water_mm"]), round(r["rain_mm"]), int(r["cycle_days_used"]),
            round(r["gdd_share"] * 100), round(r["extreme_pct"]), round(r["frost_pct"]), round(r["heat_pct"]),
            round(r["cold_pct"]), round(r["hot_pct"]), round(r["mean_temp_C"] * 10), round(r["expected_yield_pct"])] + \
           [round(r["yearly_match"][y] * 100) for y in YEARS]


def main():
    crops, soil = get_crops(), load_soil()
    out = {"scale": SCALE, "row": ROW, "dT": DT_STEPS, "rain": RAIN_STEPS, "years": YEARS,
           "summer_months": SUMMER_MONTHS, "good_score": GOOD_SCORE, "et0_per_c": ET0_PER_C, "saline_label": SALINE_WATER_LABEL,
           "zones": [], "crops": [], "weeks": None, "rows": {}, "best": {}, "static": {}, "daily": {}}

    for name, z in ZONES.items():
        s = soil.loc[name]
        out["zones"].append({"name": name, **z, "soil": {
            "texture": s["texture"], "ph": round(float(s["ph_h2o"]), 2), "soc_g_kg": round(float(s["soc_g_per_kg"]), 1),
            "clay": round(float(s["clay_pct"])), "sand": round(float(s["sand_pct"])), "silt": round(float(s["silt_pct"])),
            "fc": float(s["field_capacity_m3m3"]), "wp": float(s["wilting_point_m3m3"])}})

    for crop, p in crops.iterrows():
        num = lambda c: None if pd.isna(p[c]) else float(p[c])
        out["crops"].append({
            "key": crop, "name": p["display_name"], "t_min": p["t_opt_min"], "t_max": p["t_opt_max"],
            "t_base": num("t_base_C"), "gdd": num("gdd_to_harvest_Cd"), "kc": [p["kc_ini"], p["kc_mid"], p["kc_end"]],
            "root_m": p["root_depth_m"], "ph_opt": [p["ph_opt_min"], p["ph_opt_max"]], "ph_tol": [p["ph_tol_min"], p["ph_tol_max"]],
            "ece_threshold": p["ece_threshold"], "cycle_days": int(p["cycle_days"]), "perennial": bool(p["perennial"]),
            "months": [int(m) for m in p["plant_months"]], "assumed": bool(p["assumed"]), "notes": p["notes"]})
        for zone in ZONES:
            k = f"{crop}|{zone}"
            out["rows"][k], out["best"][k] = [], []
            for dT in DT_STEPS:
                for rain in RAIN_STEPS:
                    df = scan_year(crop, zone, dT, rain / 100)
                    if out["weeks"] is None:
                        out["weeks"] = [str(d) for d in df["planting_date"]]
                    out["rows"][k].append([encode(r) for r in df.to_dict("records")])
                    allowed = df[df["in_planting_months"]]          # same rule as scoring.best_planting
                    out["best"][k].append(int(allowed["match"].idxmax()))
            r0 = df.iloc[0]
            out["static"][k] = {"salt": r0["salt_score"], "ph_score": r0["ph_score"], "soil_ph": r0["soil_ph"],
                                "salt_drop": round((1 - r0["salt_score"]) * 100), "warning": r0["warning"],
                                "needs_saline": bool(r0["needs_saline"]), "uses_seawater": bool(r0["uses_seawater"])}
        print(f"exported {crop}")

    # Daily weather of each zone (mean of its SiAR stations, before zone offsets) for the charts
    for name, z in ZONES.items():
        w = load_siar()
        w = w[w["station"].isin(z["stations"])].groupby("date")[["t_mean_C", "t_max_C", "t_min_C", "precip_mm", "et0_mm"]].mean()
        out["daily"][name] = {"start": str(w.index[0].date()), "tmean": w["t_mean_C"].round(1).tolist(),
                              "tmax": w["t_max_C"].round(1).tolist(), "tmin": w["t_min_C"].round(1).tolist(),
                              "rain": w["precip_mm"].round(1).tolist(), "et0": w["et0_mm"].round(2).tolist()}
    # NASA SMAP L4 2023-2025 (one 9 km cell): rain, root-zone moisture, actual ET of the cell
    smap = load_daily()
    out["smap"] = {"start": str(smap["time"].iloc[0].date()), "rain": smap["precip_mm"].round(1).tolist(),
                   "sm_rootzone": smap["sm_rootzone"].round(3).tolist(), "eta": smap["eta_mm"].round(2).tolist()}

    path = DATA_DIR / "ui_data.json"
    path.write_text(json.dumps(out, separators=(",", ":")))
    print(f"Saved {path} ({path.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
