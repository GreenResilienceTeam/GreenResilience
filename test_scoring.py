"""Step 3: simple checks of the model. Run: python test_scoring.py"""
from config import ZONES
from scoring import best_planting, evaluate, get_crops, scan_year

REF_ZONE = "Inland farmland"   # zone offset 0 = the raw SMAP cell
failures = 0


def check(name, ok, info=""):
    global failures
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {info}")
    failures += 0 if ok else 1


# Best planting dates
for crop, months, label in [("tomato", [3, 4], "Mar-Apr"), ("strawberry", [10], "Oct"),
                            ("melon", [4, 5, 6], "Apr-Jun")]:
    best = best_planting(crop, REF_ZONE)
    check(f"{crop} best planting in {label}", best["planting_date"].month in months,
          f"(best = {best['planting_date']}, match {best['match']:.2f})")

# Salinity: strawberry at 10 dS/m must be far lower than at 3 dS/m
date = best_planting("strawberry", REF_ZONE)["planting_date"]
low = evaluate("strawberry", {"ece": 3, "dT_summer": 0, "dT_winter": 0}, date)["match"]
high = evaluate("strawberry", {"ece": 10, "dT_summer": 0, "dT_winter": 0}, date)["match"]
check("strawberry 10 dS/m far below 3 dS/m", high < 0.5 * low, f"(3 dS/m: {low:.2f}, 10 dS/m: {high:.2f})")

# Field Shift: +4 C makes strawberry worse
base = evaluate("strawberry", REF_ZONE, date)["match"]
hot = evaluate("strawberry", REF_ZONE, date, delta_T=4)["match"]
check("delta_T=+4 makes strawberry worse", hot < base, f"({base:.2f} -> {hot:.2f})")

# All scores in [0, 1] for every crop, zone, week, with and without a shift
bad = 0
for crop in get_crops().index:
    for zone in ZONES:
        for shift in [(0, 1.0), (4, 0.6)]:
            weeks = scan_year(crop, zone, *shift)
            cols = weeks[["match", "temp_score", "water_score", "salt_score"]]
            bad += int(((cols < 0) | (cols > 1)).sum().sum())
check("all scores between 0 and 1", bad == 0, f"({bad} out of range)")

# Sea asparagus (Salicornia): seawater is assumed available only on the Coast
sa = {z: best_planting("sea asparagus", z) for z in ZONES}
coast, inland = sa["Coast"], sa["Inland farmland"]
check("sea asparagus scores highest on Coast", all(coast["match"] > sa[z]["match"] for z in ZONES if z != "Coast"),
      "(" + ", ".join(f"{z}: {sa[z]['match']:.2f}" for z in ZONES) + ")")
check("sea asparagus low inland (no saline water)", inland["salt_score"] == 0.3 and inland["match"] <= coast["match"] - 0.15,
      f"(inland salt {inland['salt_score']}, match {inland['match']:.2f} vs coast {coast['match']:.2f})")

# Explanations follow the template
bad = []
for crop in get_crops().index:
    for zone in ZONES:
        r = best_planting(crop, zone)
        name = get_crops().loc[crop, "display_name"]
        head = f"{name} scores {r['match'] * 100:.0f}% in {zone}"
        ok = r["explanation"].startswith(head) and (". Main limit: " in r["explanation"] or " and fits well: " in r["explanation"])
        if not ok:
            bad.append(r["explanation"])
check("explanations follow the template", not bad, f"({len(bad)} bad)" + (f" e.g. {bad[0]}" if bad else ""))

# --- model v2: GDD, water balance, pH, years ---
from scoring import YEARS, ph_factor

t0 = evaluate("tomato", REF_ZONE, "2025-04-01")
t4 = evaluate("tomato", REF_ZONE, "2025-04-01", delta_T=4)
check("GDD: +4 C ripens tomato faster", t4["cycle_days_used"] < t0["cycle_days_used"],
      f"({t0['cycle_days_used']} -> {t4['cycle_days_used']} days)")
# warming shortens the season (GDD), so compare water use PER DAY, not per season
per_day = lambda r: r["crop_water_mm"] / r["cycle_days_used"]
check("Field Shift: +4 C raises tomato daily water use (ET0)", per_day(t4) > per_day(t0),
      f"({per_day(t0):.2f} -> {per_day(t4):.2f} mm/day; season {t0['crop_water_mm']:.0f} -> {t4['crop_water_mm']:.0f} mm)")
winter = evaluate("radish", REF_ZONE, "2025-12-03")
summer = evaluate("radish", REF_ZONE, "2025-07-02")
check("water: winter radish needs less irrigation than summer radish", winter["irrigation_mm"] < summer["irrigation_mm"],
      f"(winter {winter['irrigation_mm']:.0f} mm, summer {summer['irrigation_mm']:.0f} mm)")
dry = evaluate("tomato", REF_ZONE, "2025-04-01", rain_factor=0.6)
check("Field Shift: less rain means more irrigation", dry["irrigation_mm"] >= t0["irrigation_mm"],
      f"({t0['irrigation_mm']:.0f} -> {dry['irrigation_mm']:.0f} mm)")
p = get_crops().loc["tomato"]
check("pH factor: 1 inside optimum, 0.5 at tolerance limit, floor 0.3",
      ph_factor(7.0, p) == 1.0 and abs(ph_factor(p["ph_tol_max"], p) - 0.5) < 1e-9 and ph_factor(11, p) == 0.3)
blue = best_planting("blueberry", "Town")
check("blueberry limited by calcareous soil pH", blue["ph_score"] == 0.3 and "soil pH" in blue["explanation"],
      f"(pH factor {blue['ph_score']}, {blue['match']:.2f})")
check("every SiAR year is scored", sorted(t0["yearly_match"]) == YEARS, f"({sorted(t0['yearly_match'])})")
from config import load_daily
from scoring import zone_weather
smap = load_daily().set_index("time")["sm_rootzone"]
w = zone_weather(("MU130",))
same_day = [abs(w[y]["sm"][0] - smap[f"{y}-01-01"]) < 1e-9 for y in YEARS]
check("NASA SMAP soil moisture comes from the same year", all(same_day) and len(set(round(w[y]["sm"][0], 4) for y in YEARS)) == len(YEARS),
      "(1 Jan: " + ", ".join(f"{y} {w[y]['sm'][0]:.3f}" for y in YEARS) + " m3/m3)")

print(f"\n{'ALL TESTS PASSED' if failures == 0 else f'{failures} TEST(S) FAILED'}")
