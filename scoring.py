"""Step 2: the Crop Match model.

match = (temp_score * water_score * salt_score) ** (1/3)   (geometric mean)
"""
from functools import lru_cache

import numpy as np
import pandas as pd

from config import SUMMER_MONTHS, ZONES, load_daily
from crops import load_crops

# ======================= EDITABLE MODEL NUMBERS =======================
TEMP_FALLOFF_C = 8.0       # temp score falls from 1 to 0 over 8 C outside the optimum
WATER_GAP_PENALTY = 0.5    # irrigation closes the gap, so only half a penalty
SCAN_STEP_DAYS = 7         # best planting date: try one date every 7 days
YEAR_START = pd.Timestamp("2025-01-01")
# Extra penalties for problems the three scores do not see.
SPECIAL_PENALTIES = {
    "blueberry": (0.4, "Blueberry needs acidic soil (pH 4.5-5.5); local soils are "
                       "calcareous, so the match is multiplied by 0.4."),
}
# Halophytes (Salicornia) only do well with saline irrigation water (~30 g/L).
# Zone has saline water (zone["saline_water_available"]) -> salt score 1.0 (no penalty).
# Zone has none                                            -> salt score set LOW (0.3) + warning.
HALOPHYTE_SALT_SCORE = {"sea asparagus": 0.3}
HALOPHYTE_WARNING = ("Needs saline/seawater irrigation (~30 g/L). This zone is assumed to have "
                     "none, so the salt score is set to 0.3.")
GOOD_SCORE = 0.7           # all three sub-scores >= this -> "fits well" explanation
PH_REASON = "it needs acidic soil (pH 4.5-5.5) but local soils are calcareous"
# =====================================================================


@lru_cache(maxsize=1)
def get_crops():
    return load_crops()


@lru_cache(maxsize=1)
def get_climate():
    """2025 daily data repeated twice (assume next year ~ 2025) so windows can cross New Year."""
    one = load_daily()[["time", "temp_mean_C", "precip_mm"]]
    two = one.copy()
    two["time"] = two["time"] + pd.Timedelta(days=len(one))
    return pd.concat([one, two], ignore_index=True)


def zone_offsets(zone, months):
    """Daily temperature offset (C) of a zone, depending on the month."""
    is_summer = np.isin(months, SUMMER_MONTHS)
    return np.where(is_summer, zone["dT_summer"], zone["dT_winter"])


def temp_trapezoid(t, t_min, t_max):
    """1 inside [t_min, t_max], linear down to 0 at TEMP_FALLOFF_C outside."""
    below = 1 - (t_min - t) / TEMP_FALLOFF_C
    above = 1 - (t - t_max) / TEMP_FALLOFF_C
    return np.clip(np.minimum(below, above), 0, 1)


def salt_relative_yield(ece, threshold, slope):
    """FAO (Maas-Hoffman): yield falls `slope` % per dS/m above the threshold."""
    return float(np.clip(1 - slope / 100 * max(0.0, ece - threshold), 0, 1))


def evaluate(crop, zone, planting_date, delta_T=0.0, rain_factor=1.0):
    """Score one crop in one zone for one planting date.

    zone: a name from ZONES or a dict like {"ece": 10, "dT_summer": 0, "dT_winter": 0}.
    delta_T, rain_factor: the "Field Shift" (warmer climate, less rain).
    """
    p = get_crops().loc[crop]
    z = ZONES[zone] if isinstance(zone, str) else zone
    clim = get_climate()

    # Window = [planting date, planting date + cycle_days). Day-of-year puts any year on 2025.
    date = pd.Timestamp(planting_date)
    start = min(date.dayofyear, 365) - 1
    win = clim.iloc[start:start + int(p["cycle_days"])]

    # Apply zone offset and Field Shift: T' = T + zone_dT + delta_T, rain' = rain * rain_factor
    temp = win["temp_mean_C"].to_numpy() + zone_offsets(z, win["time"].dt.month.to_numpy()) + delta_T
    rain = win["precip_mm"].to_numpy() * rain_factor

    # 1) temperature: average daily trapezoid score
    temp_score = float(temp_trapezoid(temp, p["t_opt_min"], p["t_opt_max"]).mean())
    cold_pct = float((temp < p["t_opt_min"]).mean() * 100)   # % of days below the optimum
    hot_pct = float((temp > p["t_opt_max"]).mean() * 100)    # % of days above the optimum
    # 2) water: the gap between need and rain must be irrigated
    rain_mm = float(rain.sum())
    gap = max(0.0, p["water_need_mm"] - rain_mm)
    water_score = 1 - WATER_GAP_PENALTY * gap / p["water_need_mm"]
    # 3) salt: FAO relative yield
    salt_score = salt_relative_yield(z["ece"], p["ece_threshold"], p["ece_slope"])
    #    halophyte: no penalty with saline water, low score without it
    is_halophyte = crop in HALOPHYTE_SALT_SCORE
    saline_ok = bool(z.get("saline_water_available", False))
    needs_saline = is_halophyte and not saline_ok
    if is_halophyte:
        salt_score = 1.0 if saline_ok else HALOPHYTE_SALT_SCORE[crop]
    # 4) geometric mean: one bad factor pulls everything down
    match = (temp_score * water_score * salt_score) ** (1 / 3)
    # 5) special penalties (blueberry pH)
    factor, warning = SPECIAL_PENALTIES.get(crop, (1.0, ""))
    match *= factor
    if needs_saline:
        warning = HALOPHYTE_WARNING

    harvest = YEAR_START + pd.Timedelta(days=start + int(p["cycle_days"]))
    result = {
        "crop": crop, "planting_date": (YEAR_START + pd.Timedelta(days=start)).date(),
        "harvest_date": harvest.date(), "match": match, "temp_score": temp_score,
        "water_score": water_score, "salt_score": salt_score, "irrigation_mm": gap,
        "rain_mm": rain_mm, "expected_yield_pct": salt_score * temp_score * 100,
        "in_planting_months": date.month in p["plant_months"], "warning": warning, "needs_saline": needs_saline,
        "uses_seawater": is_halophyte and saline_ok, "penalty_factor": factor,
        "cold_pct": cold_pct, "hot_pct": hot_pct,
    }
    zone_name = zone if isinstance(zone, str) else z.get("name", "this zone")
    result["explanation"] = explain(p, result, zone_name)
    return result


def explain(p, r, zone_name):
    """Plain-language sentence:
    "{Crop} scores {X}% in {zone}. Main limit: {factor}, {reason}."  or, when all three
    sub-scores are good, "{Crop} scores {X}% in {zone} and fits well: {reason}."
    """
    head = f"{p['display_name']} scores {r['match'] * 100:.0f}% in {zone_name}"
    scores = {"temperature": r["temp_score"], "water": r["water_score"], "soil salinity": r["salt_score"]}
    all_good = all(v >= GOOD_SCORE for v in scores.values())
    if all_good and r["penalty_factor"] < 1:      # e.g. blueberry: the pH penalty is the real limit
        return f"{head}. Main limit: soil pH, {PH_REASON}."
    if all_good:
        if r["irrigation_mm"] >= 1:
            water = f"about {r['irrigation_mm']:.0f} mm of irrigation tops up the {r['rain_mm']:.0f} mm of rain"
        else:
            water = "rain covers its water need"
        seawater = " with seawater irrigation (assumed available)" if r["uses_seawater"] else ""
        return (f"{head} and fits well: temperature, water and soil salinity are all in a good range{seawater}; "
                f"{water}.")
    weakest = min(scores, key=scores.get)
    if weakest == "temperature":
        cold, hot = round(r["cold_pct"]), round(r["hot_pct"])   # whole % as shown in the text
        reason = (f"too cold during {cold:.0f}% of the growing season" if cold >= hot
                  else f"too hot during {hot:.0f}% of the growing season")
        if min(cold, hot) >= 1:
            reason += (f" and too hot during {hot:.0f}%" if cold >= hot else f" and too cold during {cold:.0f}%")
    elif weakest == "water":
        reason = (f"about {r['irrigation_mm']:.0f} mm of irrigation needed because only "
                  f"{r['rain_mm']:.0f} mm of rain falls in the growing season")
    elif r["needs_saline"]:
        reason = "it needs saline/seawater irrigation (~30 g/L), which this zone does not have"
    else:
        reason = f"yield drops by {(1 - r['salt_score']) * 100:.0f}% at this soil salinity"
    return f"{head}. Main limit: {weakest}, {reason}."


def scan_year(crop, zone, delta_T=0.0, rain_factor=1.0):
    """Evaluate one planting date every SCAN_STEP_DAYS through the year (as a DataFrame)."""
    dates = pd.date_range(YEAR_START, YEAR_START + pd.Timedelta(days=364), freq=f"{SCAN_STEP_DAYS}D")
    rows = [evaluate(crop, zone, d, delta_T, rain_factor) for d in dates]
    return pd.DataFrame(rows)


def best_planting(crop, zone, delta_T=0.0, rain_factor=1.0):
    """Best planting date among the allowed planting months (first one wins a tie)."""
    weeks = scan_year(crop, zone, delta_T, rain_factor)
    allowed = weeks[weeks["in_planting_months"]]
    return allowed.loc[allowed["match"].idxmax()].to_dict()
