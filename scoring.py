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
# Without it, in normal soils (ECe <= HALOPHYTE_MAX_ECE), the salt score is set LOW.
HALOPHYTE_SALT_SCORE = {"sea asparagus": 0.3}
HALOPHYTE_MAX_ECE = 6.0
HALOPHYTE_WARNING = ("Needs saline/seawater irrigation (~30 g/L). This zone is assumed to have "
                     "none, so the salt score is set to 0.3.")
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
    # 2) water: the gap between need and rain must be irrigated
    rain_mm = float(rain.sum())
    gap = max(0.0, p["water_need_mm"] - rain_mm)
    water_score = 1 - WATER_GAP_PENALTY * gap / p["water_need_mm"]
    # 3) salt: FAO relative yield
    salt_score = salt_relative_yield(z["ece"], p["ece_threshold"], p["ece_slope"])
    #    halophyte without saline water -> low score + warning
    needs_saline = (crop in HALOPHYTE_SALT_SCORE and not z.get("saline_water", False)
                    and z["ece"] <= HALOPHYTE_MAX_ECE)
    if needs_saline:
        salt_score = HALOPHYTE_SALT_SCORE[crop]
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
    }
    result["explanation"] = explain(p, result)
    return result


def explain(p, r):
    """One sentence naming the weakest of the three factors."""
    scores = {"temperature": r["temp_score"], "water": r["water_score"], "soil salinity": r["salt_score"]}
    weakest = min(scores, key=scores.get)
    detail = {
        "temperature": f"the temperatures are often outside its {p['t_opt_min']:.0f}-{p['t_opt_max']:.0f} C optimum",
        "water": f"rain covers only {r['rain_mm']:.0f} of {p['water_need_mm']:.0f} mm, so about "
                 f"{r['irrigation_mm']:.0f} mm of irrigation is needed",
        "soil salinity": f"the soil salinity is above its tolerance of {p['ece_threshold']:.1f} dS/m",
    }[weakest]
    if weakest == "soil salinity" and r["needs_saline"]:
        detail = "it needs saline/seawater irrigation, which this zone does not have"
    return f"{p['display_name']} scores {r['match'] * 100:.0f}%; the main limit is {weakest}: {detail}."


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
