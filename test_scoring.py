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

print(f"\n{'ALL TESTS PASSED' if failures == 0 else f'{failures} TEST(S) FAILED'}")
