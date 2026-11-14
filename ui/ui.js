// Crop Match UI logic. All scores come from data/ui_data.json (made by export_ui_data.py,
// which runs scoring.py). This file only looks results up and draws them.
(function () {
  "use strict";
  const D = JSON.parse(document.getElementById("data").textContent);
  const PH = JSON.parse(document.getElementById("photos").textContent);

  // Palette from the design files
  const C = { olive: "#8d9f53", olive2: "#95a750", teal: "#62958e", amber: "#d9a441", sea: "#84abc8",
    aqua: "#6da7a7", sand: "#d9d0ba", track: "#e1e6d3", light: "#b9c1ab", red: "#b9603e", ink: "#2b3a2f", brown: "#a08a5c" };
  const SEASONS = { Spring: [3, 4, 5], Summer: [6, 7, 8], Autumn: [9, 10, 11], Winter: [12, 1, 2] };
  // Map polygons from the desktop design, grouped into the three model zones (positions are illustrative)
  const ZONE_MAP = {
    "Inland farmland": { pin: [300, 476], label: [300, 536], polys: [["M300 380l60-30 30 50-50 40z", .45], ["M370 420l92-48 52 70-84 56z", .65], ["M400 500l100-40 56 60-80 60z", .55]] },
    "Town": { pin: [520, 380], label: [520, 330], polys: [["M380 330l90-50 60 62-92 58z", .8], ["M520 390l108-20 28 88-104 28z", .9]] },
    "Coast": { pin: [700, 410], label: [700, 362], polys: [["M480 280l100-28 40 80-88 44z", .85], ["M590 480l80 8 12 80-76 12z", .75]] },
  };
  const LAST_YEAR = D.years[D.years.length - 1];

  const S = { crop: D.crops.some(c => c.key === "tomato") ? "tomato" : D.crops[0].key, zone: "Inland farmland",
    iT: 0, iR: D.rain.indexOf(100), mode: "best", week: 0, zoom: 1, sheet: "half", list: false, lens: false, year: LAST_YEAR,
    info: null, expert: false, allCrops: false };

  // ---------- small helpers ----------
  const $ = id => document.getElementById(id);
  const crop = k => D.crops.find(c => c.key === k);
  const zone = n => D.zones.find(z => z.name === n);
  const K = (c, z) => c + "|" + z;
  const si = (iT = S.iT, iR = S.iR) => iT * D.rain.length + iR;
  const F = Object.fromEntries(D.row.map((n, i) => [n, i]));          // row field -> index
  const sc = v => v / D.scale;
  const pct = v => Math.round(v * 100);
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const DAY = 86400000;
  const wDate = w => new Date(D.weeks[w] + "T00:00:00Z");
  const month = w => wDate(w).getUTCMonth() + 1;
  const addDays = (d, n) => new Date(d.getTime() + n * DAY);
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmt = (d, year) => `${String(d.getUTCDate()).padStart(2, "0")} ${MON[d.getUTCMonth()]}${year ? " " + d.getUTCFullYear() : ""}`;
  const level = p => (p >= 70 ? [C.olive, "Good match"] : p >= 40 ? [C.amber, "Moderate match"] : [C.red, "Poor match"]);   // p = whole %
  const inMonths = (c, w) => crop(c).months.includes(month(w));
  const shifted = () => S.iT !== 0 || D.rain[S.iR] !== 100;
  const rainF = () => D.rain[S.iR] / 100, warm = () => D.dT[S.iT];
  const T = (x, y, txt, o = {}) => `<text x="${x}" y="${y}" font-size="${o.fs || 9}" font-family="Inter,sans-serif" fill="${o.fill || "#77827a"}"${o.anchor ? ` text-anchor="${o.anchor}"` : ""}${o.weight ? ` font-weight="${o.weight}"` : ""}>${txt}</text>`;

  // ---------- which planting week is shown ----------
  const rowsOf = (c, z, s = si()) => D.rows[K(c, z)][s];
  function seasonWeek(c, z, season) {
    const rows = rowsOf(c, z), ms = SEASONS[season];
    const anyAllowed = D.weeks.some((_, w) => ms.includes(month(w)) && inMonths(c, w));
    let best = -1, bw = -1;
    D.weeks.forEach((_, w) => {
      if (!ms.includes(month(w)) || (anyAllowed && !inMonths(c, w))) return;
      if (rows[w][F.match] > best) { best = rows[w][F.match]; bw = w; }
    });
    return bw;
  }
  function weekFor(c, z) {
    if (S.mode === "best") return D.best[K(c, z)][si()];
    if (S.mode === "week") return S.week;
    return seasonWeek(c, z, S.mode);
  }

  // ---------- one model result (looked up from the Python export, not computed) ----------
  function res(c, z, w) {
    const k = K(c, z), x = rowsOf(c, z)[w], st = D.static[k], p = crop(c);
    const base = rowsOf(c, z, si(0, D.rain.indexOf(100)))[w];
    return {
      w, zone: z, matchPct: x[F.pct], match: sc(x[F.match]), temp: sc(x[F.temp]), water: sc(x[F.water]),
      salt: st.salt, ph: st.ph_score, soilPh: st.soil_ph, saltDrop: st.salt_drop, warning: st.warning,
      needsSaline: st.needs_saline, usesSeawater: st.uses_seawater,
      irr: x[F.irr], cropWater: x[F.crop_water], effRain: x[F.eff_rain], soilWater: x[F.soil_water], rain: x[F.rain],
      cycle: x[F.cycle], gdd: x[F.gdd], extreme: x[F.extreme], frost: x[F.frost], heat: x[F.heat],
      cold: x[F.cold], hot: x[F.hot], meanT: x[F.tmean10] / 10, yld: x[F.yld],
      years: D.years.map(y => x[F["y" + y]]), basePct: base[F.pct],
      inMonths: inMonths(c, w), plant: wDate(w), harvest: addDays(wDate(w), x[F.cycle]),
    };
  }

  // Same sentence as scoring.explain() (checked against Python for every crop, zone and week)
  function explain(p, r) {
    const head = `${p.name} scores ${r.matchPct}% in ${r.zone}`;
    const scores = [["temperature", r.temp], ["water", r.water], ["soil salinity", r.salt], ["soil pH", r.ph]];
    if (scores.every(s => s[1] >= D.good_score)) {
      const water = r.irr >= 1 ? `about ${r.irr} mm of irrigation tops up the ${r.effRain} mm of effective rain` : "rain and soil water cover its needs";
      const sea = r.usesSeawater ? " with seawater irrigation (assumed available)" : "";
      return `${head} and fits well: temperature, water, soil salinity and pH are all in a good range${sea}; ${water}.`;
    }
    let weakest = scores[0];
    scores.forEach(s => { if (s[1] < weakest[1]) weakest = s; });
    let reason;
    if (weakest[0] === "temperature") {
      const cold = r.cold, hot = r.hot;
      if (r.gdd < 99) reason = `not enough heat to ripen, only ${r.gdd}% of the needed degree-days`;
      else if (r.extreme >= 5) reason = `frost or extreme heat on ${r.extreme}% of the growing season days`;
      else {
        reason = cold >= hot ? `too cold during ${cold}% of the growing season` : `too hot during ${hot}% of the growing season`;
        if (Math.min(cold, hot) >= 1) reason += cold >= hot ? ` and too hot during ${hot}%` : ` and too cold during ${cold}%`;
      }
    } else if (weakest[0] === "water") {
      reason = `about ${r.irr} mm of irrigation needed because only ${r.effRain} mm of effective rain falls in the growing season`;
    } else if (weakest[0] === "soil pH") {
      reason = `soil pH ${r.soilPh.toFixed(1)} is ${r.soilPh > p.ph_opt[1] ? "above" : "below"} its ${p.ph_opt[0]}-${p.ph_opt[1]} range`;
    } else if (r.needsSaline) {
      reason = "it needs saline/seawater irrigation (~30 g/L), which this zone does not have";
    } else {
      reason = `yield drops by ${r.saltDrop}% at this soil salinity`;
    }
    return `${head}. Main limit: ${weakest[0]}, ${reason}.`;
  }

  // ---------- SiAR station weather of the zone (for charts) ----------
  const zoneOffset = (z, m) => (D.summer_months.includes(m) ? zone(z).dT_summer : zone(z).dT_winter);
  const dayIndex = (z, d) => Math.round((d - new Date(D.daily[z].start + "T00:00:00Z")) / DAY);
  function day(z, i) {   // i = days since the zone series start; Field Shift + zone offset applied
    const dd = D.daily[z], d = addDays(new Date(dd.start + "T00:00:00Z"), i), off = zoneOffset(z, d.getUTCMonth() + 1) + warm();
    return { d, t: dd.tmean[i] + off, tmax: dd.tmax[i] + off, tmin: dd.tmin[i] + off, rain: dd.rain[i] * rainF() };
  }

  // ---------- SVG pieces ----------
  function ring(px, frac, color, text, vb = 44, r = 18, sw = 5, fs = 11) {
    const c = 2 * Math.PI * r, d = Math.max(0, Math.min(1, frac)) * c, h = vb / 2;
    return `<svg width="${px}" height="${px}" viewBox="0 0 ${vb} ${vb}" role="img" aria-label="${esc(text)}">` +
      `<circle cx="${h}" cy="${h}" r="${r}" fill="none" stroke="${C.track}" stroke-width="${sw}"/>` +
      (d > 0.5 ? `<circle cx="${h}" cy="${h}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${d.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${h} ${h})"/>` : "") +
      `<text x="${h}" y="${h}" dy=".36em" text-anchor="middle" font-family="Inter,sans-serif" font-weight="700" font-size="${fs}" fill="#2b3a2f">${esc(text)}</text></svg>`;
  }
  const dot = col => `<i class="dot" style="background:${col}"></i>`;

  // Water balance: crop water use (Kc x ET0) = effective rain + soil water + irrigation
  function waterCard(p, r) {
    const total = Math.max(r.cropWater, 1), parts = [["Effective rain", Math.min(r.effRain, total), C.sea],
      ["Soil water at planting", Math.min(r.soilWater, Math.max(0, total - r.effRain)), C.brown], ["Irrigation", r.irr, C.teal]];
    const bar = parts.map(([n, v, col]) => v > 0 ? `<span style="width:${(v / total * 100).toFixed(1)}%;background:${col}" title="${n}: ${Math.round(v)} mm"></span>` : "").join("");
    return `<div class="sec">Water balance <small>· growing season, average ${D.years[0]}–${LAST_YEAR}</small></div>` +
      `<div class="stack">${bar}</div><div class="legend">${parts.map(([n, v, col]) => `<span>${dot(col)}${n} <b>${Math.round(v)} mm</b></span>`).join("")}</div>` +
      `<p class="mini">Crop water use <b>${r.cropWater} mm</b> = Kc ${p.kc.join("–")} × ET₀ over ${r.cycle} days` +
      `${warm() ? ` (ET₀ +${Math.round(warm() * D.et0_per_c * 100)}% for +${warm()} °C)` : ""}. Rain ${r.rain} mm, of which ${r.effRain} mm is effective (SiAR).</p>`;
  }



  // Heat: GDD (cycle from temperature), frost and heat-stress days
  function heatCard(p, r) {
    const gddLine = p.gdd
      ? `Ripens after <b>${p.gdd} °C·days</b> above ${p.t_base} °C → about <b>${r.cycle} days</b> from this date${r.gdd < 99 ? ` (only ${r.gdd}% reached)` : ""}.`
      : p.perennial ? "Perennial: scored over a whole year." : `Fixed cycle of ${r.cycle} days (not driven by degree-days).`;
    return `<div class="sec">Heat <small>· degree-days and extremes</small></div>` +
      (p.gdd ? `<div class="prog"><i style="width:${Math.min(100, r.gdd)}%"></i></div>` : "") +
      `<p class="mini">${gddLine} Mean ${r.meanT.toFixed(1)} °C (optimum ${p.t_min}–${p.t_max} °C). ` +
      `Frost days ${r.frost}% · heat-stress days ${r.heat}% · below optimum ${r.cold}% · above optimum ${r.hot}% of the season.</p>`;
  }



  // Monthly rain vs evaporation demand (SiAR mean of the years) + NASA SMAP natural ET of the 9 km cell
  function monthlyChart(z) {
    const dd = D.daily[z], rain = Array(12).fill(0), et0 = Array(12).fill(0), eta = Array(12).fill(0), smapRain = Array(12).fill(0);
    dd.rain.forEach((v, i) => { const m = addDays(new Date(dd.start + "T00:00:00Z"), i).getUTCMonth(); rain[m] += v; et0[m] += dd.et0[i]; });
    const ny = D.years.length;
    const sm0 = new Date(D.smap.start + "T00:00:00Z");
    D.smap.eta.forEach((v, i) => { const m = addDays(sm0, i).getUTCMonth(); eta[m] += v; smapRain[m] += D.smap.rain[i]; });
    const R = rain.map(v => v / ny * rainF()), E = et0.map(v => v / ny * (1 + D.et0_per_c * warm()));
    const max = Math.max(...R, ...E, ...eta) * 1.08, W = 412, H = 110, x = m => 16 + m * 33, y = v => H - v / max * (H - 8);
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H + 16}" role="img" aria-label="Monthly rain and evaporation">`;
    [0.5, 1].forEach(f => { const v = Math.round(max * f / 10) * 10; s += `<line x1="0" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(43,58,51,.1)"/>` + T(2, y(v) - 2, `${v} mm`, { fs: 8 }); });
    R.forEach((v, m) => { s += `<rect x="${x(m) - 9}" y="${y(v)}" width="18" height="${H - y(v)}" rx="4" fill="${C.sea}"><title>${MON[m]}: rain ${v.toFixed(0)} mm (SiAR)</title></rect>` + T(x(m), H + 12, MON[m][0], { anchor: "middle" }); });
    const line = (arr, col, dash, label) => `<polyline fill="none" stroke="${col}" stroke-width="2" ${dash ? `stroke-dasharray="${dash}"` : ""} points="${arr.map((v, m) => `${x(m)},${y(v).toFixed(1)}`).join(" ")}"><title>${label}</title></polyline>` +
      arr.map((v, m) => `<circle cx="${x(m)}" cy="${y(v).toFixed(1)}" r="2.5" fill="${col}"><title>${MON[m]}: ${label} ${v.toFixed(0)} mm</title></circle>`).join("");
    s += line(E, C.amber, "", "ET₀ evaporation demand (SiAR)") + line(eta, C.olive, "4 3", "natural ET of the 9 km cell (NASA SMAP L4, 2025)");
    return s + "</svg>" + `<div class="legend"><span>${dot(C.sea)}rain (SiAR, mean ${D.years[0]}–${LAST_YEAR})</span><span>${dot(C.amber)}ET₀ demand (SiAR)</span><span>${dot(C.olive)}natural ET, NASA SMAP 2025</span></div>`;
  }

  function weeksChart(c, z, wSel) {   // match % for every planting week (tap = choose that date)
    const rows = rowsOf(c, z), n = rows.length, W = 412, bw = (W - 26) / n, x0 = 26;
    let s = `<svg class="chart" viewBox="0 -6 ${W} 128" role="img" aria-label="Match by planting week">`;
    [0, 50, 100].forEach(g => { const y = 100 - g; s += `<line x1="${x0}" x2="${W}" y1="${y}" y2="${y}" stroke="rgba(43,58,51,.12)"/>` + T(0, y + 3, `${g}%`, { fs: 8 }); });
    rows.forEach((v, w) => {
      const h = Math.max(1.5, sc(v[F.match]) * 100), fill = w === wSel ? C.teal : inMonths(c, w) ? C.olive : C.sand;
      s += `<rect class="wk" data-act="week" data-w="${w}" x="${(x0 + w * bw + 0.6).toFixed(1)}" y="${(100 - h).toFixed(1)}" width="${(bw - 1.2).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="${fill}"><title>${fmt(wDate(w))}: ${v[F.pct]}%${inMonths(c, w) ? "" : " (outside planting months)"}</title></rect>`;
    });
    let lastM = 0;
    rows.forEach((_, w) => { const m = month(w); if (m !== lastM && m % 2 === 1) s += T((x0 + w * bw).toFixed(1), 116, MON[m - 1]); lastM = m; });
    return s + "</svg>" + `<div class="legend"><span>${dot(C.olive)}usual planting months</span><span>${dot(C.sand)}other weeks</span><span>${dot(C.teal)}shown date</span></div>`;
  }

  function climateChart(c, z, r) {   // daily temperature (min-max band) + rain around the growing window, chosen year
    const p = crop(c), plant = new Date(Date.UTC(S.year, r.plant.getUTCMonth(), r.plant.getUTCDate()));
    const a = dayIndex(z, plant), b = a + r.cycle, len = D.daily[z].tmean.length;
    const lo = Math.max(0, a - 30), hi = Math.min(len - 1, b + 30), days = [];
    for (let i = lo; i <= hi; i++) days.push(day(z, i));
    const tMin = Math.min(...days.map(d => d.tmin), p.t_min) - 1, tMax = Math.max(...days.map(d => d.tmax), p.t_max) + 1;
    const pMax = Math.max(...days.map(d => d.rain), 5), W = 412, x = i => ((i - lo) / Math.max(1, hi - lo)) * W, y = t => 8 + (1 - (t - tMin) / (tMax - tMin)) * 100;
    let s = `<svg class="chart" viewBox="0 0 ${W} 186" role="img" aria-label="Daily temperature and rain">`;
    s += `<rect x="${x(a)}" y="0" width="${Math.max(0, Math.min(x(b), W) - x(a))}" height="170" fill="${C.teal}" opacity=".12"/>`;
    s += `<rect x="0" y="${y(p.t_max)}" width="${W}" height="${y(p.t_min) - y(p.t_max)}" fill="${C.olive}" opacity=".16"/>` + T(4, y(p.t_max) + 11, `optimum ${p.t_min}–${p.t_max} °C`, { fill: "#566a22" });
    s += `<polygon fill="${C.amber}" opacity=".22" points="${days.map((d, k) => `${x(lo + k).toFixed(1)},${y(d.tmax).toFixed(1)}`).join(" ")} ${days.map((d, k) => `${x(lo + k).toFixed(1)},${y(d.tmin).toFixed(1)}`).reverse().join(" ")}"/>`;
    s += `<polyline fill="none" stroke="${C.amber}" stroke-width="1.6" stroke-linejoin="round" points="${days.map((d, k) => `${x(lo + k).toFixed(1)},${y(d.t).toFixed(1)}`).join(" ")}"/>`;
    days.forEach((d, k) => { if (d.tmin <= 0) s += `<circle cx="${x(lo + k).toFixed(1)}" cy="${y(d.tmin).toFixed(1)}" r="2" fill="${C.sea}"><title>frost ${fmt(d.d)}</title></circle>`; });
    days.forEach((d, k) => { if (d.rain > 0.2) { const h = d.rain / pMax * 38; s += `<rect x="${x(lo + k).toFixed(1)}" y="${(168 - h).toFixed(1)}" width="1.8" height="${h.toFixed(1)}" fill="${C.sea}"><title>${fmt(d.d)}: ${d.rain.toFixed(1)} mm</title></rect>`; } });
    s += `<line x1="0" x2="${W}" y1="168" y2="168" stroke="rgba(43,58,51,.2)"/>`;
    days.forEach((d, k) => { if (d.d.getUTCDate() === 1) s += T(x(lo + k).toFixed(1), 181, MON[d.d.getUTCMonth()], { fs: 8.5 }); });
    s += T(W, y(tMax - 1) + 9, `${(tMax - 1).toFixed(0)} °C`, { anchor: "end", fs: 8.5 }) + T(W, y(tMin + 1) - 2, `${(tMin + 1).toFixed(0)} °C`, { anchor: "end", fs: 8.5 });
    return `<div class="ychips">${D.years.map(y => `<button class="ychip${y === S.year ? " on" : ""}" data-act="year" data-year="${y}">${y}</button>`).join("")}</div>` + s + "</svg>" +
      `<div class="legend"><span>${dot(C.amber)}daily mean, band = min–max</span><span>${dot(C.sea)}rain</span><span>${dot(C.teal)}growing window</span></div>`;
  }

  // ---------- map ----------
  function mapSVG() {
    let s = `<defs><radialGradient id="g" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#95a750" stop-opacity=".55"/><stop offset="1" stop-color="#95a750" stop-opacity="0"/></radialGradient></defs>`;
    s += `<rect x="-2000" y="-2000" width="6000" height="5000" fill="#ece4d2"/>`;
    s += `<g fill="none" stroke="#d9d0ba"><path d="M-400 180C200 140 360 220 560 160S800 150 900 190"/><path d="M-400 230C200 190 380 280 580 215S800 200 900 240"/><path d="M-400 640C220 600 380 690 580 650"/><path d="M-400 690C220 650 400 740 600 700"/><path d="M-400 90C200 60 380 120 600 80"/></g>`;
    s += `<path d="M830 0C790 150 850 270 800 400C770 500 880 570 840 680C830 760 890 800 960 810L960 3000L3000 3000L3000 -2000L830 -2000Z" fill="#84abc8"/>`;
    s += `<path d="M560 520C620 480 760 500 780 570C800 650 720 740 620 730C530 720 490 590 560 520Z" fill="#6da7a7" opacity=".85"/>`;
    s += `<path d="M-400 760C200 730 420 790 640 770L640 810L-400 810Z" fill="#84abc8" opacity=".5"/>`;
    const sel = ZONE_MAP[S.zone].pin;
    s += `<circle cx="${sel[0]}" cy="${sel[1]}" r="230" fill="url(#g)"/>`;
    s += `<g fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-dasharray="4 9" opacity=".7"><path d="M1000 140C920 170 880 210 810 240"/><path d="M1000 300C920 320 870 350 800 380"/><path d="M1000 460C940 470 890 500 830 530"/></g>`;
    s += `<text x="905" y="400" text-anchor="middle" font-family="Inter,sans-serif" font-style="italic" font-size="15" fill="#1f4a63">Mar Menor</text><text x="670" y="640" text-anchor="middle" font-family="Inter,sans-serif" font-size="14" fill="#14403f">Salt Flats</text>`;
    // zones: polygons + pin + label, coloured by the match of the selected crop
    let pins = ""; const k = Math.max(1, 0.8 / (S.scale || 1)), fs = (14 * k).toFixed(1);
    Object.entries(ZONE_MAP).forEach(([name, zm]) => {
      const r = res(S.crop, name, weekFor(S.crop, name)), [col] = level(r.matchPct), on = name === S.zone;
      s += `<g class="zone" data-act="zone" data-zone="${esc(name)}" tabindex="0" role="button" aria-label="${esc(name)}: ${r.matchPct}% match"><g stroke="#ece4d2" stroke-width="3">` +
        zm.polys.map(([d, o]) => `<path class="poly" d="${d}" fill="${col}" opacity="${o}"/>`).join("") + `</g></g>`;
      const [px, py] = zm.pin, [lx, ly] = zm.label;
      pins += `<g class="zone" data-act="zone" data-zone="${esc(name)}">`;
      if (on) pins += `<circle cx="${px}" cy="${py}" r="42" fill="none" stroke="#95a750" stroke-width="3" opacity=".6"/><circle class="pin-ring" cx="${px}" cy="${py}" r="22" fill="#62958e" stroke="#fff" stroke-width="4"/><circle cx="${px}" cy="${py}" r="7" fill="#fff"/>`;
      else pins += `<circle class="pin-ring" cx="${px}" cy="${py}" r="20" fill="#fff" stroke="${col}" stroke-width="3"/><circle cx="${px}" cy="${py}" r="8" fill="${col}"/>`;
      pins += `<text x="${lx}" y="${ly + (k - 1) * (ly < py ? -14 : 14)}" text-anchor="middle" font-family="Inter,sans-serif" font-weight="700" font-size="${fs}" fill="#2b3a2f" stroke="#ece4d2" stroke-width="${5 * k}" paint-order="stroke">${esc(innerWidth <= 860 ? name.split(" ")[0] : name)} · ${r.matchPct}%</text></g>`;
    });
    s += pins;
    s += `<text x="520" y="452" text-anchor="middle" font-family="Fraunces,serif" font-size="${(24 * Math.max(1, 0.7 / (S.scale || 1))).toFixed(1)}" fill="#2b3a2f" stroke="#ece4d2" stroke-width="4" paint-order="stroke" pointer-events="none">San Pedro del Pinatar</text>`;
    return s;
  }

  function sheetPx() {   // full sheet stops below the search bar and season chips
    return S.sheet === "full" ? innerHeight - 144 : innerHeight * { peek: 0.27, half: 0.5 }[S.sheet];
  }
  function fitView() {   // place the zones in the free part of the screen
    const W = innerWidth, H = innerHeight, mobile = W <= 860, panelW = W > 1180 ? 444 : 404;
    const box = mobile ? { x: 200, y: 290, w: 580, h: 290 } : { x: 260, y: 240, w: 480, h: 360 };
    const free = mobile ? { x: 4, y: 130, w: W - 60, h: Math.max(120, H - sheetPx() - 140) }
      : { x: 24, y: 130, w: Math.max(200, W - panelW - 90), h: H - 190 };
    let s = Math.min(free.w / box.w, free.h / box.h) * (mobile ? 0.98 : 0.66);
    s = Math.max(0.35, Math.min(s, 1.15)) * S.zoom; S.scale = s;
    const vx = box.x + box.w / 2 - (free.x + free.w / 2) / s, vy = box.y + box.h / 2 - (free.y + free.h / 2) / s;
    $("map").setAttribute("viewBox", `${vx.toFixed(1)} ${vy.toFixed(1)} ${(W / s).toFixed(1)} ${(H / s).toFixed(1)}`);
  }

  // ---------- top bar ----------
  function renderTop() {
    $("cropchip").textContent = crop(S.crop).name;
    const modes = [["best", "Best date"], ...Object.keys(SEASONS).map(m => [m, m])];
    $("seasons").innerHTML = modes.map(([m, l]) => `<button class="chip${S.mode === m ? " on" : ""}" data-act="mode" data-mode="${m}">${l}</button>`).join("");
    const list = $("croplist");
    list.hidden = !S.list;
    if (S.list) {
      list.innerHTML = `<div class="hint">Match in ${esc(S.zone)}</div>` + D.crops.map(c => {
        const r = res(c.key, S.zone, weekFor(c.key, S.zone)), [col] = level(r.matchPct);
        const img = PH[c.key] ? `<img src="${PH[c.key].src}" alt="">` : `<span class="ph">${esc(c.name[0])}</span>`;
        return `<button class="opt${c.key === S.crop ? " on" : ""}" role="option" data-act="crop" data-crop="${esc(c.key)}">${img}<span class="nm">${esc(c.name)}</span><span class="pct" style="background:${col}">${r.matchPct}%</span></button>`;
      }).join("");
    }
    const lb = $("lensbtn");
    lb.textContent = shifted() ? `Field Shift · +${warm()} °C · ${D.rain[S.iR]}%` : "Lenses · Field Shift";
    lb.classList.toggle("active", shifted());
    $("lens").hidden = !S.lens;
    $("sT").value = S.iT; $("sR").value = S.iR;
    $("vT").textContent = `+${warm()} °C`; $("vR").textContent = `${D.rain[S.iR]}% of measured rain`;
  }

  // ---------- farmer view helpers ----------
  const VERDICT = p => (p >= 70 ? "Good choice" : p >= 40 ? "Possible with care" : "Not recommended");
  const status = v => (v >= D.good_score ? [C.olive, "Good"] : v >= 0.4 ? [C.amber, "Fair"] : [C.red, "Problem"]);
  const m3 = mm => (Math.round(mm) * 10).toLocaleString("en-US");          // 1 mm = 10 m³ per hectare
  const part = d => (d <= 10 ? "early" : d <= 20 ? "mid" : "late");
  const MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const when = d => `${part(d.getUTCDate())} ${MONTH_FULL[d.getUTCMonth()]}`;
  const q = (kind, label) => `<button class="qbtn" data-act="info" data-info="${kind}" aria-label="How is ${label} calculated?">?</button>`;
  function monthWeek(c, z, m) {   // best planting week inside month m (1-12)
    const rows = rowsOf(c, z); let best = -1, bw = -1;
    D.weeks.forEach((_, w) => { if (month(w) === m && rows[w][F.match] > best) { best = rows[w][F.match]; bw = w; } });
    return bw;
  }

  function calendarBlock(c, z, p, r) {
    const rows = rowsOf(c, z), harvestM = r.harvest.getUTCMonth() + 1, plantM = r.plant.getUTCMonth() + 1;
    const cells = MON.map((name, i) => {
      const m = i + 1, w = monthWeek(c, z, m), v = rows[w][F.pct], allowed = p.months.includes(m), [col] = level(v);
      const cls = [allowed ? "" : "out", m === plantM ? "sel" : "", m === harvestM && !p.perennial ? "hv" : ""].join(" ").trim();
      return `<button class="${cls}" style="background:${col}" data-act="month" data-month="${m}" title="${MONTH_FULL[i]}: best ${v}%${allowed ? "" : " (not a usual planting month)"}">${name[0]}</button>`;
    }).join("");
    const txt = p.perennial
      ? `Perennial: plant once. The score covers a full year from <b>${fmt(r.plant)}</b>.`
      : `Plant in <b>${when(r.plant)}</b> → harvest around <b>${when(r.harvest)}</b> (≈${r.cycle} days).`;
    return `<div class="block"><div class="block-h"><span>📅 When to plant</span>${q("calendar", "the planting date")}</div>` +
      `<div class="cal">${cells}</div><div class="cal-txt">${txt}${r.inMonths ? "" : " <em>Outside its usual planting months.</em>"}</div></div>`;
  }

  function factRows(p, r, zz) {
    const [tc, ts] = status(r.temp), [wc, ws] = status(r.water), soilScore = Math.min(r.salt, r.ph), [sc_, ss] = status(soilScore);
    let tTxt;
    if (r.gdd < 99) tTxt = `May not ripen: only ${r.gdd}% of the heat it needs.`;
    else if (r.frost + r.heat >= 5) tTxt = `${r.frost}% frost days and ${r.heat}% very hot days in the season.`;
    else if (r.temp >= D.good_score) {   // good score: calm wording, mention a mild issue only
      const mild = Math.max(r.cold, r.hot) >= 15 ? (r.cold >= r.hot ? `; cooler than ideal on ${r.cold}% of days` : `; warmer than ideal on ${r.hot}% of days`) : "";
      tTxt = `Average ${r.meanT.toFixed(0)} °C, mostly inside its ${p.t_min}–${p.t_max} °C range${mild}.`;
    } else tTxt = r.cold >= r.hot ? `Too cold on ${r.cold}% of days (likes ${p.t_min}–${p.t_max} °C).` : `Too hot on ${r.hot}% of days (likes ${p.t_min}–${p.t_max} °C).`;
    const covered = Math.min(100, Math.round(100 * (r.effRain + r.soilWater) / Math.max(1, r.cropWater)));
    const wTxt = r.irr >= 1 ? `Irrigate ≈ <b class="inl">${m3(r.irr)} m³/ha</b> per season (${r.irr} mm). Rain and soil cover ${covered}%.${r.usesSeawater ? " Seawater." : ""}`
      : "Rain and soil water cover what it needs.";
    const salt = r.needsSaline ? "needs seawater irrigation (none here)" : r.usesSeawater ? "seawater irrigation assumed, salt is fine"
      : r.saltDrop > 0 ? `salt cuts yield by ${r.saltDrop}%` : "salinity fine";
    const ph = r.ph < 1 ? `pH ${r.soilPh.toFixed(1)} (prefers ${p.ph_opt[0]}–${p.ph_opt[1]})` : `pH ${r.soilPh.toFixed(1)} fine`;
    const row = (kind, icon, label, v, col, word, txt) => `<div class="fact">${ring(40, v, col, icon, 44, 18, 5, 15)}` +
      `<div class="fact-t"><b>${label}<em style="color:${col}">· ${word}</em></b>${txt}</div>${q(kind, label.toLowerCase())}</div>`;
    return `<div class="block"><div class="block-h"><span>Why this score</span></div><div class="facts">` +
      row("temp", "🌡", "Temperature", r.temp, tc, ts, tTxt) + row("water", "💧", "Water", r.water, wc, ws, wTxt) +
      row("soil", "🧂", "Soil", soilScore, sc_, ss, `${salt[0].toUpperCase() + salt.slice(1)} · ${ph}.`) + `</div></div>`;
  }

  function otherCrops(c, z, w) {
    const ranked = D.crops.map(cc => ({ c: cc, r: res(cc.key, z, weekFor(cc.key, z)) })).sort((x, y) => y.r.match - x.r.match);
    const top = ranked.filter(x => x.c.key !== c).slice(0, 3);
    const card = ({ c: cc, r }) => { const [col] = level(r.matchPct);
      return `<button class="tc" data-act="crop" data-crop="${esc(cc.key)}">${PH[cc.key] ? `<img src="${PH[cc.key].src}" alt="">` : `<span class="ph"></span>`}<b>${esc(cc.name)}</b><span style="background:${col}">${r.matchPct}%</span></button>`; };
    let h = `<div class="block"><div class="block-h"><span>Other crops for ${esc(z)}</span></div><div class="top3">${top.map(card).join("")}</div>`;
    if (S.allCrops) h += `<div class="rank">` + ranked.map(({ c: cc, r }) => `<button class="rk" data-act="crop" data-crop="${esc(cc.key)}"><span>${esc(cc.name)}</span><span class="bar"><i style="width:${Math.max(1, r.match * 100)}%;background:${cc.key === c ? C.teal : C.light}"></i></span><b>${r.matchPct}%</b></button>`).join("") + `</div>`;
    return h + `<button class="linkbtn" data-act="allcrops">${S.allCrops ? "Show fewer" : "Compare all 10 crops"}</button></div>`;
  }

  // ---------- "?" cards: how each answer is calculated, with this crop's own numbers ----------
  function infoCard(kind) {
    const c = S.crop, z = S.zone, p = crop(c), w = weekFor(c, z), r = res(c, z, w), zz = zone(z), st = zz.stations.join(" + ");
    const li = rows => `<ul class="nums">${rows.map(([a, b]) => `<li><span>${a}</span><b>${b}</b></li>`).join("")}</ul>`;
    const src = s => `<div class="src">Sources: ${s}</div>`;
    const years = `${D.years[0]}–${LAST_YEAR}`;
    const cards = {
      match: ["Crop match", `<p>One number for how well the crop fits this place and date. Each factor is a score from 0 to 1; a single weak factor pulls the whole match down.</p>` +
        `<div class="formula">match = ∛(temperature × water × salinity) × soil pH factor</div>` +
        li([["Temperature", pct(r.temp) + "%"], ["Water", pct(r.water) + "%"], ["Salinity", pct(r.salt) + "%"], ["Soil pH factor", r.ph.toFixed(2)], ["Match (average of " + D.years.length + " years)", r.matchPct + "%"], ["Expected yield vs ideal*", r.yld + "%"]]) +
        `<p>* Yield index = salinity × temperature × pH factor. It ignores water because irrigation can fix water; it is an index, not tonnes.</p>` + src("model in scoring.py, weather SiAR " + years)],
      calendar: ["When to plant", `<p>We test a planting date every 7 days of the year and keep the best one inside the crop's usual planting months (biologists' table). Each month shows its best week: green good, yellow possible, red poor; faded months are outside the usual planting months. Tap a month to see it.</p>` +
        (p.gdd ? `<p>The season ends when the crop has collected enough heat (growing degree-days):</p><div class="formula">GDD = Σ max(0, daily mean − ${p.t_base} °C) ≥ ${p.gdd} °C·days</div>` +
          li([["Planting", fmt(r.plant)], ["Heat reached", r.gdd + "%"], ["Season length", r.cycle + " days"], ["Harvest", fmt(r.harvest, true)]]) + `<p>Warmer weather (Field Shift) fills the heat faster, so the season gets shorter.</p>`
          : li([["Planting", fmt(r.plant)], ["Season length", r.cycle + " days (fixed" + (p.perennial ? ", perennial" : "") + ")"]])) +
        src("SiAR stations " + st + ", " + years + "; base temperature and degree-days: data/crop_params_extra.csv")],
      temp: ["Temperature", `<p>Every day of the season gets a score: 1 when the daily mean is inside the crop's comfort range, falling to 0 at 8 °C outside it. Frost (min ≤ 0 °C) and heat-stress days (max ≥ ${p.t_max + 10} °C) take extra points off.</p>` +
        `<div class="formula">temperature = average daily score × (1 − 2 × share of frost/heat days)${p.gdd ? " × share of the needed heat reached" : ""}</div>` +
        li([["Comfort range", `${p.t_min}–${p.t_max} °C`], ["Average in the season", r.meanT.toFixed(1) + " °C"], ["Days below / above range", `${r.cold}% / ${r.hot}%`], ["Frost / heat-stress days", `${r.frost}% / ${r.heat}%`], ["Temperature score", pct(r.temp) + "%"]]) +
        src(`SiAR stations ${st} (daily min, mean, max), ${years}${zz.dT_summer ? `; +${zz.dT_summer} °C urban heat (estimate)` : ""}`)],
      water: ["Water", `<p>How much water the crop uses each day depends on the weather (reference evaporation, ET₀) and on its growth stage (crop coefficient Kc). What rain and the soil do not supply must be irrigated.</p>` +
        `<div class="formula">crop water use = Σ Kc × ET₀<br>irrigation = water use − effective rain − water in the soil at planting<br>water score = 1 − 0.5 × irrigation ÷ water use</div>` +
        `<div class="stack">${[[r.effRain, C.sea], [Math.min(r.soilWater, Math.max(0, r.cropWater - r.effRain)), C.brown], [r.irr, C.teal]].map(([v, col]) => v > 0 ? `<span style="width:${(v / Math.max(1, r.cropWater) * 100).toFixed(1)}%;background:${col}"></span>` : "").join("")}</div>` +
        `<div class="legend"><span>${dot(C.sea)}effective rain</span><span>${dot(C.brown)}soil water</span><span>${dot(C.teal)}irrigation</span></div>` +
        li([["Kc (start – middle – end)", p.kc.join(" – ")], ["Crop water use", r.cropWater + " mm"], ["Effective rain (of " + r.rain + " mm)", r.effRain + " mm"], ["Soil water at planting", r.soilWater + " mm"], ["Irrigation", `${r.irr} mm = ${m3(r.irr)} m³/ha`], ["Water score", pct(r.water) + "%"]]) +
        `<p>1 mm of water on 1 hectare = 10 m³. Only half the gap counts against the crop, because irrigation can close it.</p>` +
        src(`ET₀ and effective rain: SiAR ${st}, ${years}; soil water: NASA SMAP L4 root-zone moisture × ${p.root_m} m roots, SoilGrids texture; Kc: FAO-56`)],
      soil: ["Soil", `<p>Salt in the soil lowers yield above a crop-specific threshold (FAO). Soil pH far from the crop's range makes nutrients hard to take up; a soft factor lowers the match.</p>` +
        `<div class="formula">salinity score = 1 − slope × (soil salinity − threshold)<br>pH factor = 1 in the best range → 0.5 at the tolerance limit → never below 0.3</div>` +
        `<div class="phbar"><span class="tol" style="left:${phx(p.ph_tol[0])}%;width:${phx(p.ph_tol[1]) - phx(p.ph_tol[0])}%"></span><span class="opt" style="left:${phx(p.ph_opt[0])}%;width:${phx(p.ph_opt[1]) - phx(p.ph_opt[0])}%"></span><span class="mark" style="left:${phx(zz.soil.ph)}%"></span></div>` +
        `<div class="phscale">${[4, 5, 6, 7, 8, 9].map(v => `<span style="left:${phx(v)}%">${v}</span>`).join("")}</div>` +
        li([["Soil salinity (estimate)", zz.ece + " dS/m"], ["Salt threshold of this crop", p.ece_threshold + " dS/m"], ["Salinity score", pct(r.salt) + "%"], ["Soil pH / best range", `${zz.soil.ph.toFixed(1)} / ${p.ph_opt.join("–")}`], ["pH factor", r.ph.toFixed(2)], ["Soil type", `${zz.soil.texture}, ${zz.soil.soc_g_kg} g/kg organic carbon`]]) +
        (zz.saline_water_available ? `<p>Coast: ${esc(D.saline_label)} (assumption) — this matters for sea asparagus.</p>` : "") +
        src("salinity: model estimate (Campo de Cartagena soils measured 2–10 dS/m), FAO salt tolerance; pH, texture, carbon: ISRIC SoilGrids 250 m")],
      years: ["Year by year", `<p>The score is calculated separately for every year of measured weather and then averaged. A crop that only works in a wet year is risky.</p>` +
        `<div class="years">${r.years.map((v, i) => { const [col] = level(v); return `<div class="yr"><span class="yb"><i style="height:${Math.max(4, v)}%;background:${col}"></i></span><b>${v}%</b><small>${D.years[i]}</small></div>`; }).join("")}</div>` +
        `<p>Good = 70% or more.</p>` + src(`SiAR stations ${st}`)],
      shift: ["Field Shift", `<p>“What if the climate shifts?” Every day of the measured years is made warmer and/or drier, and the whole model runs again.</p>` +
        `<div class="formula">temperature + ${warm()} °C · rain × ${D.rain[S.iR]}% · evaporation demand + ${Math.round(D.et0_per_c * 100 * warm())}%</div>` +
        li([["Match now → shifted", `${r.basePct}% → ${r.matchPct}%`]]) + src("same model; ET₀ rises ~3% per °C (assumption)")],
    };
    const [title, body] = cards[kind];
    return `<button class="close" data-act="closeinfo" aria-label="Close">×</button><h3 id="infoTitle">${title}</h3>${body}`;
  }
  const phx = v => ((Math.min(9.5, Math.max(4, v)) - 4) / 5.5 * 100).toFixed(1);

  // ---------- result panel ----------
  function renderPanel() {
    const c = S.crop, z = S.zone, p = crop(c), w = weekFor(c, z), r = res(c, z, w), [col] = level(r.matchPct), zz = zone(z);
    const good = r.years.filter(v => v >= 70).length;
    let h = `<div class="hdr"><button data-act="info" data-info="match" aria-label="How is the match calculated?" style="padding:0">${ring(64, r.match, col, r.matchPct + "%", 56, 22, 6, 14)}</button>` +
      `<div><div class="title">${esc(p.name)} <span>(${esc(z)})</span></div><span class="verdict" style="background:${col}">${VERDICT(r.matchPct)}</span>` +
      `<div class="reliab">${r.years.map(v => `<i class="${v >= 70 ? "on" : ""}"></i>`).join("")} good in ${good} of ${D.years.length} years ${q("years", "the yearly result")}</div></div></div>`;
    if (PH[c]) h += `<figure class="photo"><img src="${PH[c].src}" alt="${esc(p.name)}"><figcaption>${esc(PH[c].credit)}</figcaption></figure>`;
    h += `<p class="desc">${esc(explain(p, r))}</p>`;
    if (r.warning) h += `<div class="banner">⚠ ${esc(r.warning)}</div>`;
    h += calendarBlock(c, z, p, r) + factRows(p, r, zz);
    if (shifted()) {
      const base = rowsOf(c, z, si(0, D.rain.indexOf(100)))[w], dIrr = r.irr - base[F.irr];
      h += `<div class="shiftline"><span>With <b>+${warm()} °C</b> and <b>${D.rain[S.iR]}% rain</b>: match ${r.basePct}% → <b>${r.matchPct}%</b>, irrigation ${dIrr >= 0 ? "+" : "−"}${m3(Math.abs(dIrr))} m³/ha.</span>${q("shift", "Field Shift")}</div>`;
    }
    h += otherCrops(c, z, w);
    h += `<button class="expert" data-act="expert" aria-expanded="${S.expert ? "true" : "false"}">How we calculated <span>${S.expert ? "▴" : "▾"}</span></button>`;
    if (S.expert) {
      h += `<div class="expert-body"><p class="mini">Match = ∛(temperature × water × salinity) × soil pH factor, averaged over ${D.years.length} years of SiAR weather. Tap any <b>?</b> for the details of one factor.</p>`;
      h += waterCard(p, r) + heatCard(p, r);
      h += `<div class="sec">Rain vs evaporation <small>· per month</small></div>${monthlyChart(z)}`;
      h += `<div class="sec">Match by planting week <small>· tap a bar to choose a date</small></div>${weeksChart(c, z, w)}`;
      h += `<div class="sec">Temperature & rain <small>· growing window ± 30 days</small></div>${climateChart(c, z, r)}`;
      h += `<p class="note">${p.assumed ? `Assumed values for this crop: ${esc(p.notes)}. ` : ""}Town has no station: mean of MU120 + MU130 plus +1 °C urban heat (estimate). Windows that run past 31 Dec ${LAST_YEAR} reuse ${LAST_YEAR} data.</p>`;
      h += `<div class="sources"><span>NASA SMAP L4 · soil moisture, natural ET</span><span>SiAR MU120 · MU130 · weather, ET₀ ${D.years[0]}–${LAST_YEAR}</span><span>SoilGrids · texture, pH, carbon</span><span>FAO-56 · crop water</span></div>`;
      h += `<div class="limits"><b>Limitations</b><ul>` +
        `<li>SMAP is 9 km: one grid cell covers all zones; it is used for soil moisture and natural ET, not for zone differences.</li>` +
        `<li>Soil salinity is not measurable by satellite; zone values are model estimates (Campo de Cartagena soils measured 2–10 dS/m).</li>` +
        `<li>Weather: SiAR stations ${D.years[0]}–${LAST_YEAR} (gaps filled from the nearest station, flagged). Town is estimated.</li>` +
        `<li>SoilGrids values are 250 m model predictions; pH ranges and degree-days need checking by the biologists.</li>` +
        `<li>The map is an illustration; zone shapes are not surveyed boundaries.</li>` +
        `<li>Data source: NASA SMAP L4 SPL4SMGP v008; SiAR (MAPA); ISRIC SoilGrids 2.0; FAO-56.</li></ul></div>`;
      h += `<div class="credits">Photos via Openverse: ` + Object.entries(PH).map(([k, v]) => `<a href="${esc(v.source)}" target="_blank" rel="noopener">${esc(crop(k) ? crop(k).name : k)}</a> (${esc(v.short)})`).join(", ") + `.</div></div>`;
    }
    $("panelBody").innerHTML = h;
    const info = $("info");
    info.hidden = !S.info;
    if (S.info) info.innerHTML = infoCard(S.info);
  }

  function render() { renderTop(); fitView(); $("map").innerHTML = mapSVG(); renderPanel(); }

  // ---------- events ----------
  document.addEventListener("click", e => {
    const el = e.target.closest("[data-act]");
    if (!el) { if (S.list) { S.list = false; renderTop(); } return; }
    const act = el.dataset.act;
    if (act === "list") { S.list = !S.list; S.lens = false; renderTop(); return; }
    if (act === "crop") { S.crop = el.dataset.crop; S.list = false; S.info = null; }
    else if (act === "zone") { S.zone = el.dataset.zone; S.list = false; }
    else if (act === "mode") { S.mode = el.dataset.mode; }
    else if (act === "week") { S.mode = "week"; S.week = +el.dataset.w; }
    else if (act === "year") { S.year = +el.dataset.year; }
    else if (act === "month") { const m = +el.dataset.month; S.mode = "week"; S.week = monthWeek(S.crop, S.zone, m); }
    else if (act === "info") { S.info = el.dataset.info; if (innerWidth <= 860) { S.sheet = "full"; applySheet(); } }
    else if (act === "closeinfo") { S.info = null; }
    else if (act === "expert") { S.expert = !S.expert; }
    else if (act === "allcrops") { S.allCrops = !S.allCrops; }
    else if (act === "zoom") { S.zoom = Math.min(S.zoom * 1.3, 2.6); }
    else if (act === "locate") { S.zoom = 1; }
    else if (act === "lens") { S.lens = !S.lens; S.list = false; }
    else if (act === "reset") { S.iT = 0; S.iR = D.rain.indexOf(100); }
    const scroll = $("panelBody").scrollTop;
    render();
    if (["year", "week", "month", "info", "closeinfo", "expert", "allcrops"].includes(act)) $("panelBody").scrollTop = scroll;   // keep the reader's place
  });
  document.addEventListener("keydown", e => {
    if ((e.key === "Enter" || e.key === " ") && e.target.classList && e.target.classList.contains("zone")) { e.preventDefault(); e.target.dispatchEvent(new MouseEvent("click", { bubbles: true })); }
    if (e.key === "Escape") { S.list = false; S.lens = false; S.info = null; render(); }
  });
  $("sT").addEventListener("input", e => { S.iT = +e.target.value; render(); });
  $("sR").addEventListener("input", e => { S.iR = +e.target.value; render(); });
  addEventListener("resize", () => { applySheet(); render(); });

  // bottom sheet (phones): drag or tap the handle -> peek / half / full
  function applySheet() { $("panel").style.setProperty("--sheet-h", sheetPx() + "px"); }
  (function sheetDrag() {
    const hd = $("handle"), panel = $("panel");
    let y0 = null, h0 = 0, moved = false;
    hd.addEventListener("pointerdown", e => { y0 = e.clientY; h0 = panel.getBoundingClientRect().height; moved = false; panel.classList.add("dragging"); hd.setPointerCapture(e.pointerId); });
    hd.addEventListener("pointermove", e => {
      if (y0 === null) return;
      const dy = y0 - e.clientY; if (Math.abs(dy) > 6) moved = true;
      panel.style.setProperty("--sheet-h", Math.max(innerHeight * 0.2, Math.min(innerHeight * 0.95, h0 + dy)) + "px");
    });
    hd.addEventListener("pointerup", () => {
      if (y0 === null) return;
      panel.classList.remove("dragging");
      const h = panel.getBoundingClientRect().height / innerHeight, order = ["peek", "half", "full"];
      if (!moved) S.sheet = order[(order.indexOf(S.sheet) + 1) % 3];
      else S.sheet = h < 0.41 ? "peek" : h < 0.74 ? "half" : "full";
      y0 = null; applySheet(); render();
    });
  })();

  applySheet();
  render();
  window.__cropMatch = { res, explain, crop, D, S };   // used by the consistency check
})();
