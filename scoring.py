"""Step 2: the Crop Match model (v2).

For a crop, a zone and a planting date the model looks at the growing window in every year of
SiAR station weather (2023-2025) and averages the yearly results.

  temperature  mean daily temperature inside the crop's optimum (trapezoid), minus frost / heat days;
               for crops with a GDD value the cycle length comes from accumulated heat (GDD)
  water        crop water use = Kc x ET0 (FAO-56, ET0 from SiAR);
               irrigation = water use - effective rain - water already stored in the root zone
  salinity     FAO relative yield at the zone's soil salinity (Salicornia: seawater rule)
  soil pH      soft factor from the zone's soil pH (SoilGrids)

  match = (temp * water * salt) ** (1/3) * pH factor
"""
from functools import lru_cache

import numpy as np
import pandas as pd

from config import DATA_DIR, SUMMER_MONTHS, YEARS, ZONES, load_daily
from crops import load_crops

# ======================= EDITABLE MODEL NUMBERS =======================
TEMP_FALLOFF_C = 8.0       # temp score falls from 1 to 0 over 8 C outside the optimum
FROST_C = 0.0              # a day with Tmin <= 0 C is a frost day
HEAT_MARGIN_C = 10.0       # a day with Tmax >= t_opt_max + 10 C is a heat-stress day
EXTREME_PENALTY = 2.0      # temperature score loses 2% for each 1% of frost/heat days
GDD_MAX_FACTOR = 2.0       # a GDD crop may take at most 2x its nominal cycle to ripen
WATER_GAP_PENALTY = 0.5    # irrigation closes the gap, so only half a penalty
ET0_PER_C = 0.03           # Field Shift: ET0 rises ~3% per C of warming (ASSUMPTION, Hargreaves-like)
PH_EDGE_SCORE = 0.5        # soft pH factor: 1 inside the optimum, 0.5 at the tolerance limit ...
PH_FLOOR = 0.3             # ... and never below 0.3
SCAN_STEP_DAYS = 7         # best planting date: try one date every 7 days
YEAR_START = pd.Timestamp("2025-01-01")   # planting dates are shown on a 2025 calendar
# Halophytes (Salicornia) only do well with saline irrigation water (~30 g/L).
# Zone has saline water (zone["saline_water_available"]) -> salt score 1.0 (no penalty).
# Zone has none                                            -> salt score set LOW (0.3) + warning.
HALOPHYTE_SALT_SCORE = {"sea asparagus": 0.3}
HALOPHYTE_WARNING = ("Needs saline/seawater irrigation (~30 g/L). This zone is assumed to have "
                     "none, so the salt score is set to 0.3.")
GOOD_SCORE = 0.7           # all sub-scores >= this -> "fits well" explanation
DEFAULT_ZONE = "Inland farmland"   # stations and soil used when a test passes a custom zone dict
# =====================================================================


@lru_cache(maxsize=1)
def get_crops():
    return load_crops()


@lru_cache(maxsize=1)
def load_siar():
    """Daily SiAR station weather (made by prepare_siar.py)."""
    return pd.read_csv(DATA_DIR / "yearly" / "siar_daily.csv", parse_dates=["date"])


@lru_cache(maxsize=1)
def load_soil():
    """Static soil per zone (made by prepare_soil.py)."""
    return pd.read_csv(DATA_DIR / "static" / "soil_zones.csv").set_index("zone")


@lru_cache(maxsize=None)
def zone_weather(stations):
    """{year: daily weather of that year + the next one} for the mean of the given stations.

    Two consecutive years let a growing window cross New Year. After the last year the same
    year is repeated (ASSUMPTION). Root-zone soil moisture comes from NASA SMAP L4 of the same
    day (2023-2025); days after the last year reuse the last year's same calendar day.
    """
    s = load_siar()
    cols = ["t_mean_C", "t_max_C", "t_min_C", "precip_mm", "precip_eff_mm", "et0_mm"]
    daily = s[s["station"].isin(stations)].groupby("date")[cols].mean()
    smap = load_daily()
    sm = dict(zip(smap["time"].dt.strftime("%Y-%m-%d"), smap["sm_rootzone"]))
    last = YEARS[-1]
    def sm_of(d):   # SMAP of that day; after the last year: same day of the last year
        key = d.strftime("%Y-%m-%d") if d.year <= last else f"{last}-{d.strftime('%m-%d')}"
        return sm.get(key, sm.get(key[:8] + "28"))
    out = {}
    for y in YEARS:
        nxt = y + 1 if y + 1 in YEARS else y
        w = pd.concat([daily[daily.index.year == y], daily[daily.index.year == nxt]])
        dates = pd.date_range(f"{y}-01-01", periods=len(w), freq="D")
        out[y] = {"date": dates, "month": dates.month.to_numpy(),
                  "tmean": w["t_mean_C"].to_numpy(), "tmax": w["t_max_C"].to_numpy(),
                  "tmin": w["t_min_C"].to_numpy(), "rain": w["precip_mm"].to_numpy(),
                  "peff": w["precip_eff_mm"].to_numpy(), "et0": w["et0_mm"].to_numpy(),
                  "sm": np.array([sm_of(d) for d in dates])}
    return out


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


def ph_factor(ph, p):
    """Soft pH factor: 1 inside the optimum, linear down to 0.5 at the tolerance limit,
    then down to 0.3 one pH unit further, never lower."""
    if p["ph_opt_min"] <= ph <= p["ph_opt_max"]:
        return 1.0
    edge, tol = (p["ph_opt_max"], p["ph_tol_max"]) if ph > p["ph_opt_max"] else (p["ph_opt_min"], p["ph_tol_min"])
    span, dist = abs(tol - edge), abs(ph - edge)
    if dist <= span:
        return 1 - (1 - PH_EDGE_SCORE) * dist / span
    return max(PH_FLOOR, PH_EDGE_SCORE - (PH_EDGE_SCORE - PH_FLOOR) * (dist - span))


def kc_curve(p, n):
    """FAO-56 crop coefficient for each day of an n-day cycle.
    Flat Kc_ini, rising to Kc_mid, flat, falling to Kc_end. Perennials: yearly mean Kc."""
    if pd.isna(p["stage_ini"]):
        return np.full(n, np.mean([p["kc_ini"], p["kc_mid"], p["kc_end"]]))
    f = np.array([p["stage_ini"], p["stage_dev"], p["stage_mid"], p["stage_late"]], dtype=float)
    e = np.cumsum(f / f.sum()) * n
    return np.interp(np.arange(n) + 0.5, [0, e[0], e[1], e[2], n],
                     [p["kc_ini"], p["kc_ini"], p["kc_mid"], p["kc_mid"], p["kc_end"]])


def one_year(p, z, soil, w, start, delta_T, rain_factor):
    """Scores for one year of weather; `start` = index of the planting day in w."""
    temp_all = w["tmean"] + zone_offsets(z, w["month"]) + delta_T
    # cycle length: from heat (GDD) when the crop has a GDD value, else fixed
    nominal = int(p["cycle_days"])
    gdd_share = 1.0
    if pd.notna(p["gdd_to_harvest_Cd"]):
        max_len = int(nominal * GDD_MAX_FACTOR)
        gdd = np.cumsum(np.maximum(0, temp_all[start:start + max_len] - p["t_base_C"]))
        reached = np.nonzero(gdd >= p["gdd_to_harvest_Cd"])[0]
        cycle = int(reached[0]) + 1 if len(reached) else max_len
        gdd_share = min(1.0, float(gdd[cycle - 1]) / p["gdd_to_harvest_Cd"])
    else:
        cycle = nominal
    win = slice(start, start + cycle)
    off = zone_offsets(z, w["month"][win]) + delta_T
    t, tmax, tmin = temp_all[win], w["tmax"][win] + off, w["tmin"][win] + off

    # 1) temperature: trapezoid on the daily mean, minus frost/heat days, times heat reached (GDD)
    frost_pct = float((tmin <= FROST_C).mean() * 100)
    heat_pct = float((tmax >= p["t_opt_max"] + HEAT_MARGIN_C).mean() * 100)
    extreme_pct = float(((tmin <= FROST_C) | (tmax >= p["t_opt_max"] + HEAT_MARGIN_C)).mean() * 100)
    trapezoid = float(temp_trapezoid(t, p["t_opt_min"], p["t_opt_max"]).mean())
    temp_score = float(np.clip(trapezoid * (1 - EXTREME_PENALTY * extreme_pct / 100), 0, 1)) * gdd_share

    # 2) water: Kc x ET0 - effective rain - water stored in the root zone at planting
    et0 = w["et0"][win] * (1 + ET0_PER_C * delta_T)
    crop_water = float((kc_curve(p, cycle) * et0).sum())
    eff_rain = float(w["peff"][win].sum() * rain_factor)
    rain = float(w["rain"][win].sum() * rain_factor)
    theta = min(float(w["sm"][start]), soil["field_capacity_m3m3"])
    stored = max(0.0, theta - soil["wilting_point_m3m3"]) * 1000 * p["root_depth_m"]
    irrigation = max(0.0, crop_water - eff_rain - stored)
    water_score = 1 - WATER_GAP_PENALTY * irrigation / crop_water if crop_water > 0 else 1.0

    return {"temp_score": temp_score, "water_score": water_score, "cycle_days_used": cycle,
            "gdd_share": gdd_share, "frost_pct": frost_pct, "heat_pct": heat_pct, "extreme_pct": extreme_pct,
            "cold_pct": float((t < p["t_opt_min"]).mean() * 100), "hot_pct": float((t > p["t_opt_max"]).mean() * 100),
            "mean_temp_C": float(t.mean()), "crop_water_mm": crop_water, "eff_rain_mm": eff_rain, "rain_mm": rain,
            "soil_water_mm": stored, "irrigation_mm": irrigation, "et0_mm": float(et0.sum()),
            "sm_rootzone_start": float(w["sm"][start])}


def evaluate(crop, zone, planting_date, delta_T=0.0, rain_factor=1.0):
    """Score one crop in one zone for one planting date (average over the SiAR years).

    zone: a name from ZONES or a dict like {"ece": 10, "dT_summer": 0, "dT_winter": 0}
          (a dict without "stations" uses the stations and soil of DEFAULT_ZONE).
    delta_T, rain_factor: the "Field Shift" (warmer climate, less rain).
    """
    p = get_crops().loc[crop]
    z = ZONES[zone] if isinstance(zone, str) else zone
    zone_name = zone if isinstance(zone, str) else z.get("name", "this zone")
    soil = load_soil().loc[zone if isinstance(zone, str) else z.get("soil_zone", DEFAULT_ZONE)]
    weather = zone_weather(tuple(z.get("stations", ZONES[DEFAULT_ZONE]["stations"])))

    date = pd.Timestamp(planting_date)
    start = min(date.dayofyear, 365) - 1
    years = {y: one_year(p, z, soil, w, start, delta_T, rain_factor) for y, w in weather.items()}

    # 3) salt: FAO relative yield; halophyte: no penalty with saline water, low score without it
    salt_score = salt_relative_yield(z["ece"], p["ece_threshold"], p["ece_slope"])
    is_halophyte = crop in HALOPHYTE_SALT_SCORE
    saline_ok = bool(z.get("saline_water_available", False))
    needs_saline = is_halophyte and not saline_ok
    if is_halophyte:
        salt_score = 1.0 if saline_ok else HALOPHYTE_SALT_SCORE[crop]
    # 4) soil pH (soft factor)
    ph = float(soil["ph_h2o"])
    ph_score = ph_factor(ph, p)

    # 5) match per year, then average over the years
    for r in years.values():
        r["match"] = (r["temp_score"] * r["water_score"] * salt_score) ** (1 / 3) * ph_score
    keys = years[YEARS[0]].keys()
    result = {k: float(np.mean([r[k] for r in years.values()])) for k in keys}
    result["yearly_match"] = {y: r["match"] for y, r in years.items()}
    result["years_good"] = sum(r["match"] >= GOOD_SCORE for r in years.values())

    warning = HALOPHYTE_WARNING if needs_saline else ""
    if ph_score < PH_EDGE_SCORE:
        warning = (f"{p['display_name']} needs soil pH {p['ph_opt_min']:g}-{p['ph_opt_max']:g}; local soils are "
                   f"calcareous (pH {ph:.1f}), so the match is multiplied by {ph_score:.1f}.")
    cycle = int(round(result["cycle_days_used"]))
    result.update({
        "crop": crop, "planting_date": (YEAR_START + pd.Timedelta(days=start)).date(),
        "harvest_date": (YEAR_START + pd.Timedelta(days=start + cycle)).date(), "cycle_days_used": cycle,
        "salt_score": salt_score, "ph_score": ph_score, "soil_ph": ph,
        "expected_yield_pct": salt_score * result["temp_score"] * ph_score * 100,
        "in_planting_months": date.month in p["plant_months"], "warning": warning,
        "needs_saline": needs_saline, "uses_seawater": is_halophyte and saline_ok,
    })
    result["explanation"] = explain(p, result, zone_name)
    return result


def explain(p, r, zone_name):
    """Plain-language sentence:
    "{Crop} scores {X}% in {zone}. Main limit: {factor}, {reason}."  or, when all
    sub-scores are good, "{Crop} scores {X}% in {zone} and fits well: {reason}."
    """
    head = f"{p['display_name']} scores {r['match'] * 100:.0f}% in {zone_name}"
    scores = {"temperature": r["temp_score"], "water": r["water_score"],
              "soil salinity": r["salt_score"], "soil pH": r["ph_score"]}
    irr, eff = round(r["irrigation_mm"]), round(r["eff_rain_mm"])   # whole numbers as shown in the text
    if all(v >= GOOD_SCORE for v in scores.values()):
        if irr >= 1:
            water = f"about {irr} mm of irrigation tops up the {eff} mm of effective rain"
        else:
            water = "rain and soil water cover its needs"
        seawater = " with seawater irrigation (assumed available)" if r["uses_seawater"] else ""
        return (f"{head} and fits well: temperature, water, soil salinity and pH are all in a good range{seawater}; "
                f"{water}.")
    weakest = min(scores, key=scores.get)
    if weakest == "temperature":
        cold, hot = round(r["cold_pct"]), round(r["hot_pct"])   # whole % as shown in the text
        gdd, extreme = round(r["gdd_share"] * 100), round(r["extreme_pct"])
        if gdd < 99:
            reason = f"not enough heat to ripen, only {gdd}% of the needed degree-days"
        elif extreme >= 5:
            reason = f"frost or extreme heat on {extreme}% of the growing season days"
        else:
            reason = (f"too cold during {cold}% of the growing season" if cold >= hot
                      else f"too hot during {hot}% of the growing season")
            if min(cold, hot) >= 1:
                reason += (f" and too hot during {hot}%" if cold >= hot else f" and too cold during {cold}%")
    elif weakest == "water":
        reason = f"about {irr} mm of irrigation needed because only {eff} mm of effective rain falls in the growing season"
    elif weakest == "soil pH":
        side = "above" if r["soil_ph"] > p["ph_opt_max"] else "below"
        reason = f"soil pH {r['soil_ph']:.1f} is {side} its {p['ph_opt_min']:g}-{p['ph_opt_max']:g} range"
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
