// Green Resilience UI logic. All scores come from data/ui_data.json (made by export_ui_data.py,
// which runs scoring.py). This file only looks results up and draws them.
(function () {
  "use strict";
  const D = JSON.parse(document.getElementById("data").textContent);
  const PH = JSON.parse(document.getElementById("photos").textContent);
  const LOGO = document.getElementById("logo").textContent.trim();   // team logo (data URI)
  const logoImg = cls => `<img class="${cls}" src="${LOGO}" alt="">`;

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

  // ---------- language: English or Spanish (texts in ui/i18n.js) ----------
  const LANGS = ["en", "es"];
  function initialTheme() {   // the visitor's last choice, else the system setting
    let saved = null;
    try { saved = localStorage.getItem("gr-theme"); } catch (e) { /* storage blocked */ }
    if (saved === "dark" || saved === "light") return saved;
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function initialLang() {   // the visitor's last choice, else the browser language
    let saved = null;
    try { saved = localStorage.getItem("gr-lang"); } catch (e) { /* storage blocked */ }
    if (LANGS.includes(saved)) return saved;
    return (navigator.language || "").toLowerCase().startsWith("es") ? "es" : "en";
  }

  const S = { crop: D.crops.some(c => c.key === "tomato") ? "tomato" : D.crops[0].key, zone: "Inland farmland",
    iT: 0, iR: D.rain.indexOf(100), mode: "best", week: 0, zoom: 1, sheet: "half", list: false, lens: false, year: LAST_YEAR,
    info: null, expert: false, allCrops: false, page: "home", lang: initialLang(), theme: initialTheme(),
    view: "crop", seasonOther: false };   // view: "crop" card or "season" catalogue
  document.documentElement.dataset.theme = S.theme;

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
  const L = () => I18N[S.lang];                                       // texts of the chosen language
  const cname = k => L().crops[k] || crop(k).name;                   // crop name
  const zname = z => L().zones[z] || z;                              // zone name
  const zshort = z => L().zoneShort[z] || z;                         // short zone name (phones)
  const texture = t => L().textures[t] || t;                         // soil texture
  const dec = v => (S.lang === "es" ? String(v).replace(".", ",") : String(v));   // decimal comma in Spanish
  const nf = (v, d) => dec(Number(v).toFixed(d));
  const MON = () => L().mon;
  const fmt = (d, year) => `${String(d.getUTCDate()).padStart(2, "0")} ${MON()[d.getUTCMonth()]}${year ? " " + d.getUTCFullYear() : ""}`;
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

  // Same sentence as scoring.explain() in English (checked against Python for every crop, zone and week);
  // the Spanish sentence is built from the same numbers with the same rules.
  function explain(p, r) {
    const X = L().ex, es = S.lang === "es";
    const head = X.head(cname(p.key), r.matchPct, zname(r.zone));
    const scores = [["temperature", r.temp], ["water", r.water], ["soil salinity", r.salt], ["soil pH", r.ph]];
    if (scores.every(s => s[1] >= D.good_score)) {
      const water = r.irr >= 1 ? X.tops(r.irr, r.effRain) : X.covers;
      return head + X.good(r.usesSeawater ? X.sea : "", water);
    }
    let weakest = scores[0];
    scores.forEach(s => { if (s[1] < weakest[1]) weakest = s; });
    let reason;
    if (weakest[0] === "temperature") {
      const cold = r.cold, hot = r.hot;
      if (r.gdd < 99) reason = X.gdd(r.gdd);
      else if (r.extreme >= 5) reason = X.extreme(r.extreme);
      else {
        reason = cold >= hot ? X.cold(cold) : X.hot(hot);
        if (Math.min(cold, hot) >= 1) reason += cold >= hot ? X.andHot(hot) : X.andCold(cold);
      }
    } else if (weakest[0] === "water") {
      reason = X.water(r.irr, r.effRain);
    } else if (weakest[0] === "soil pH") {
      reason = X.ph(es ? nf(r.soilPh, 1) : r.soilPh.toFixed(1), r.soilPh > p.ph_opt[1], dec(p.ph_opt[0]), dec(p.ph_opt[1]));
    } else if (r.needsSaline) {
      reason = X.saline;
    } else {
      reason = X.salt(r.saltDrop);
    }
    return head + X.limit(X.factors[weakest[0]], reason);
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
    const T_ = L(), total = Math.max(r.cropWater, 1), parts = [[T_.effRain, Math.min(r.effRain, total), C.sea],
      [T_.soilWater, Math.min(r.soilWater, Math.max(0, total - r.effRain)), C.brown], [T_.irrigation, r.irr, C.teal]];
    const bar = parts.map(([n, v, col]) => v > 0 ? `<span style="width:${(v / total * 100).toFixed(1)}%;background:${col}" title="${n}: ${Math.round(v)} mm"></span>` : "").join("");
    const shift = warm() ? T_.wbShift(Math.round(warm() * D.et0_per_c * 100), warm()) : "";
    return `<div class="sec">${T_.wbTitle} <small>· ${T_.wbSub(D.years[0], LAST_YEAR)}</small></div>` +
      `<div class="stack">${bar}</div><div class="legend">${parts.map(([n, v, col]) => `<span>${dot(col)}${n} <b>${Math.round(v)} mm</b></span>`).join("")}</div>` +
      `<p class="mini">${T_.wbLine(r.cropWater, p.kc.map(dec).join("–"), r.cycle, shift, r.rain, r.effRain)}</p>`;
  }

  // Heat: GDD (cycle from temperature), frost and heat-stress days
  function heatCard(p, r) {
    const T_ = L();
    const line = p.gdd ? T_.gddLine(p.gdd, dec(p.t_base), r.cycle, r.gdd < 99 ? T_.gddPart(r.gdd) : "")
      : p.perennial ? T_.perennialLine : T_.fixedLine(r.cycle);
    return `<div class="sec">${T_.heatTitle} <small>· ${T_.heatSub}</small></div>` +
      (p.gdd ? `<div class="prog"><i style="width:${Math.min(100, r.gdd)}%"></i></div>` : "") +
      `<p class="mini">${line} ${T_.heatStats(nf(r.meanT, 1), dec(p.t_min), dec(p.t_max), r.frost, r.heat, r.cold, r.hot)}</p>`;
  }

  // Monthly rain vs evaporation demand (SiAR mean of the years) + NASA SMAP natural ET of the 9 km cell
  function monthlyChart(z) {
    const T_ = L(), M = MON(), dd = D.daily[z], rain = Array(12).fill(0), et0 = Array(12).fill(0), eta = Array(12).fill(0);
    dd.rain.forEach((v, i) => { const m = addDays(new Date(dd.start + "T00:00:00Z"), i).getUTCMonth(); rain[m] += v; et0[m] += dd.et0[i]; });
    const ny = D.years.length, sm0 = new Date(D.smap.start + "T00:00:00Z");
    D.smap.eta.forEach((v, i) => { eta[addDays(sm0, i).getUTCMonth()] += v / ny; });   // mean of the SMAP years
    const R = rain.map(v => v / ny * rainF()), E = et0.map(v => v / ny * (1 + D.et0_per_c * warm()));
    const max = Math.max(...R, ...E, ...eta) * 1.08, W = 412, H = 110, x = m => 16 + m * 33, y = v => H - v / max * (H - 8);
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H + 16}" role="img" aria-label="${T_.rvAria}">`;
    [0.5, 1].forEach(f => { const v = Math.round(max * f / 10) * 10; s += `<line x1="0" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(43,58,51,.1)"/>` + T(2, y(v) - 2, `${v} mm`, { fs: 8 }); });
    R.forEach((v, m) => { s += `<rect x="${x(m) - 9}" y="${y(v)}" width="18" height="${H - y(v)}" rx="4" fill="${C.sea}"><title>${T_.rvRainTip(M[m], v.toFixed(0))}</title></rect>` + T(x(m), H + 12, M[m][0].toUpperCase(), { anchor: "middle" }); });
    const line = (arr, col, dash, label) => `<polyline fill="none" stroke="${col}" stroke-width="2" ${dash ? `stroke-dasharray="${dash}"` : ""} points="${arr.map((v, m) => `${x(m)},${y(v).toFixed(1)}`).join(" ")}"><title>${label}</title></polyline>` +
      arr.map((v, m) => `<circle cx="${x(m)}" cy="${y(v).toFixed(1)}" r="2.5" fill="${col}"><title>${M[m]}: ${label} ${v.toFixed(0)} mm</title></circle>`).join("");
    s += line(E, C.amber, "", T_.rvEt0Tip) + line(eta, C.olive, "4 3", T_.rvEtaTip(D.years[0], LAST_YEAR));
    return s + "</svg>" + `<div class="legend"><span>${dot(C.sea)}${T_.rvRain(D.years[0], LAST_YEAR)}</span><span>${dot(C.amber)}${T_.rvEt0}</span><span>${dot(C.olive)}${T_.rvEta(D.years[0], LAST_YEAR)}</span></div>`;
  }

  function weeksChart(c, z, wSel) {   // match % for every planting week (tap = choose that date)
    const T_ = L(), rows = rowsOf(c, z), n = rows.length, W = 412, bw = (W - 26) / n, x0 = 26;
    let s = `<svg class="chart" viewBox="0 -6 ${W} 128" role="img" aria-label="${T_.wkAria}">`;
    [0, 50, 100].forEach(g => { const y = 100 - g; s += `<line x1="${x0}" x2="${W}" y1="${y}" y2="${y}" stroke="rgba(43,58,51,.12)"/>` + T(0, y + 3, `${g}%`, { fs: 8 }); });
    rows.forEach((v, w) => {
      const h = Math.max(1.5, sc(v[F.match]) * 100), fill = w === wSel ? C.teal : inMonths(c, w) ? C.olive : C.sand;
      s += `<rect class="wk" data-act="week" data-w="${w}" x="${(x0 + w * bw + 0.6).toFixed(1)}" y="${(100 - h).toFixed(1)}" width="${(bw - 1.2).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="${fill}"><title>${fmt(wDate(w))}: ${v[F.pct]}%${inMonths(c, w) ? "" : T_.wkOutside}</title></rect>`;
    });
    let lastM = 0;
    rows.forEach((_, w) => { const m = month(w); if (m !== lastM && m % 2 === 1) s += T((x0 + w * bw).toFixed(1), 116, MON()[m - 1]); lastM = m; });
    return s + "</svg>" + `<div class="legend"><span>${dot(C.olive)}${T_.wkUsual}</span><span>${dot(C.sand)}${T_.wkOther}</span><span>${dot(C.teal)}${T_.wkShown}</span></div>`;
  }

  function climateChart(c, z, r) {   // daily temperature (min-max band) + rain around the growing window, chosen year
    const T_ = L(), p = crop(c), plant = new Date(Date.UTC(S.year, r.plant.getUTCMonth(), r.plant.getUTCDate()));
    const a = dayIndex(z, plant), b = a + r.cycle, len = D.daily[z].tmean.length;
    const lo = Math.max(0, a - 30), hi = Math.min(len - 1, b + 30), days = [];
    for (let i = lo; i <= hi; i++) days.push(day(z, i));
    const tMin = Math.min(...days.map(d => d.tmin), p.t_min) - 1, tMax = Math.max(...days.map(d => d.tmax), p.t_max) + 1;
    const pMax = Math.max(...days.map(d => d.rain), 5), W = 412, x = i => ((i - lo) / Math.max(1, hi - lo)) * W, y = t => 8 + (1 - (t - tMin) / (tMax - tMin)) * 100;
    let s = `<svg class="chart" viewBox="0 0 ${W} 186" role="img" aria-label="${T_.clAria}">`;
    s += `<rect x="${x(a)}" y="0" width="${Math.max(0, Math.min(x(b), W) - x(a))}" height="170" fill="${C.teal}" opacity=".12"/>`;
    s += `<rect x="0" y="${y(p.t_max)}" width="${W}" height="${y(p.t_min) - y(p.t_max)}" fill="${C.olive}" opacity=".16"/>` + T(4, y(p.t_max) + 11, T_.optimum(dec(p.t_min), dec(p.t_max)), { fill: "#566a22" });
    s += `<polygon fill="${C.amber}" opacity=".22" points="${days.map((d, k) => `${x(lo + k).toFixed(1)},${y(d.tmax).toFixed(1)}`).join(" ")} ${days.map((d, k) => `${x(lo + k).toFixed(1)},${y(d.tmin).toFixed(1)}`).reverse().join(" ")}"/>`;
    s += `<polyline fill="none" stroke="${C.amber}" stroke-width="1.6" stroke-linejoin="round" points="${days.map((d, k) => `${x(lo + k).toFixed(1)},${y(d.t).toFixed(1)}`).join(" ")}"/>`;
    days.forEach((d, k) => { if (d.tmin <= 0) s += `<circle cx="${x(lo + k).toFixed(1)}" cy="${y(d.tmin).toFixed(1)}" r="2" fill="${C.sea}"><title>${T_.frostTip(fmt(d.d))}</title></circle>`; });
    days.forEach((d, k) => { if (d.rain > 0.2) { const h = d.rain / pMax * 38; s += `<rect x="${x(lo + k).toFixed(1)}" y="${(168 - h).toFixed(1)}" width="1.8" height="${h.toFixed(1)}" fill="${C.sea}"><title>${fmt(d.d)}: ${nf(d.rain, 1)} mm</title></rect>`; } });
    s += `<line x1="0" x2="${W}" y1="168" y2="168" stroke="rgba(43,58,51,.2)"/>`;
    days.forEach((d, k) => { if (d.d.getUTCDate() === 1) s += T(x(lo + k).toFixed(1), 181, MON()[d.d.getUTCMonth()], { fs: 8.5 }); });
    s += T(W, y(tMax - 1) + 9, `${(tMax - 1).toFixed(0)} °C`, { anchor: "end", fs: 8.5 }) + T(W, y(tMin + 1) - 2, `${(tMin + 1).toFixed(0)} °C`, { anchor: "end", fs: 8.5 });
    return `<div class="ychips">${D.years.map(y => `<button class="ychip${y === S.year ? " on" : ""}" data-act="year" data-year="${y}">${y}</button>`).join("")}</div>` + s + "</svg>" +
      `<div class="legend"><span>${dot(C.amber)}${T_.clMean}</span><span>${dot(C.sea)}${T_.clRain}</span><span>${dot(C.teal)}${T_.clWindow}</span></div>`;
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
    s += `<text x="905" y="400" text-anchor="middle" font-family="Inter,sans-serif" font-style="italic" font-size="15" fill="#1f4a63">Mar Menor</text><text x="670" y="640" text-anchor="middle" font-family="Inter,sans-serif" font-size="14" fill="#14403f">${L().saltFlats}</text>`;
    // zones: polygons + pin + label, coloured by the match of the selected crop
    let pins = ""; const k = Math.max(1, 0.8 / (S.scale || 1)), fs = (14 * k).toFixed(1);
    Object.entries(ZONE_MAP).forEach(([name, zm]) => {
      const zs = zoneShown(name), r = { matchPct: zs.pct }, [col] = level(zs.pct), on = name === S.zone;
      s += `<g class="zone" data-act="zone" data-zone="${esc(name)}" tabindex="0" role="button" aria-label="${esc(L().zoneAria(zname(name), r.matchPct))}"><g stroke="#ece4d2" stroke-width="3">` +
        zm.polys.map(([d, o]) => `<path class="poly" d="${d}" fill="${col}" opacity="${o}"/>`).join("") + `</g></g>`;
      const [px, py] = zm.pin, [lx, ly] = zm.label;
      pins += `<g class="zone" data-act="zone" data-zone="${esc(name)}">`;
      if (on) pins += `<circle cx="${px}" cy="${py}" r="42" fill="none" stroke="#95a750" stroke-width="3" opacity=".6"/><circle class="pin-ring" cx="${px}" cy="${py}" r="22" fill="#62958e" stroke="#fff" stroke-width="4"/><circle cx="${px}" cy="${py}" r="7" fill="#fff"/>`;
      else pins += `<circle class="pin-ring" cx="${px}" cy="${py}" r="20" fill="#fff" stroke="${col}" stroke-width="3"/><circle cx="${px}" cy="${py}" r="8" fill="${col}"/>`;
      pins += `<text x="${lx}" y="${ly + (k - 1) * (ly < py ? -14 : 14)}" text-anchor="middle" font-family="Inter,sans-serif" font-weight="700" font-size="${fs}" fill="#2b3a2f" stroke="#ece4d2" stroke-width="${5 * k}" paint-order="stroke">${esc(pinLabel(name, zs))}</text></g>`;
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

  // ---------- real map: MapLibre + OpenFreeMap (OpenStreetMap data, free, no key) ----------
  // Zone shapes are APPROXIMATE (illustration of the three model zones around San Pedro del Pinatar).
  const ZONE_GEO = {
    "Town": [[[-0.806, 37.829], [-0.795, 37.826], [-0.784, 37.829], [-0.779, 37.841], [-0.786, 37.851], [-0.800, 37.850], [-0.808, 37.841], [-0.806, 37.829]]],
    "Coast": [[[-0.784, 37.829], [-0.771, 37.834], [-0.761, 37.848], [-0.763, 37.864], [-0.775, 37.868], [-0.781, 37.857], [-0.779, 37.841], [-0.784, 37.829]],
              [[-0.815, 37.823], [-0.806, 37.829], [-0.795, 37.826], [-0.784, 37.829], [-0.787, 37.821], [-0.800, 37.817], [-0.815, 37.817], [-0.815, 37.823]]],
    "Inland farmland": [[[-0.870, 37.822], [-0.815, 37.823], [-0.806, 37.829], [-0.808, 37.841], [-0.812, 37.860], [-0.870, 37.864], [-0.870, 37.822]]],
  };
  const ZONE_PIN = { "Town": [-0.793, 37.839], "Coast": [-0.770, 37.853], "Inland farmland": [-0.842, 37.843] };
  const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
  const SAT = { url: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/{z}/{y}/{x}.jpg",
    attribution: '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless 2023</a> by EOX (modified Copernicus Sentinel data)' };
  let MAP = null, REAL = false, SATON = false;
  const MARKERS = {};

  // map colours for the light and dark theme
  const MAPPAL = {
    light: { bg: "#ece4d2", water: "#84abc8", bld: "#ddd2b8", bldLine: "#cfc3a6", sand: "#efe2c2", green: "#d9dcb6", urban: "#e4d9c1",
      border: "#c2b79c", rail: "#cfc4aa", road: "#fbf8f0", waterText: "#1f4a63", text: "#2b3a2f", ink: "#2b3a2f" },
    dark: { bg: "#1b231e", water: "#24404f", bld: "#2b342e", bldLine: "#38433b", sand: "#38352a", green: "#233027", urban: "#222a24",
      border: "#4a574d", rail: "#424e45", road: "#36413a", waterText: "#9cc3dc", text: "#d6dfcc", ink: "#e3e9d8" },
  };
  const zoneLineColor = () => ["case", ["==", ["get", "on"], 1], MAPPAL[S.theme].ink, ["get", "color"]];
  function restyle() {   // recolour the OpenStreetMap style with the design palette
    const M = MAPPAL[S.theme];
    const set = (id, prop, val) => { try { MAP.setPaintProperty(id, prop, val); } catch (e) { /* layer without this property */ } };
    MAP.getStyle().layers.forEach(l => {
      const id = l.id.toLowerCase();
      if (l.type === "background") set(l.id, "background-color", M.bg);
      else if (l.type === "fill") {
        if (/water|ocean|sea|lake|river|basin/.test(id)) set(l.id, "fill-color", M.water);
        else if (/building/.test(id)) { set(l.id, "fill-color", M.bld); set(l.id, "fill-outline-color", M.bldLine); }
        else if (/sand|beach/.test(id)) set(l.id, "fill-color", M.sand);
        else if (/park|wood|forest|grass|landcover|farm|meadow|vegetation|scrub|orchard|vineyard/.test(id)) { set(l.id, "fill-color", M.green); set(l.id, "fill-opacity", 0.7); }
        else if (/residential|landuse|urban|industrial|commercial/.test(id)) set(l.id, "fill-color", M.urban);
      } else if (l.type === "line") {
        if (/water|river|stream|canal/.test(id)) set(l.id, "line-color", M.water);
        else if (/boundary|admin/.test(id)) set(l.id, "line-color", M.border);
        else if (/rail/.test(id)) set(l.id, "line-color", M.rail);
        else if (/road|highway|street|path|motorway|trunk|primary|secondary|tertiary|minor|service|track|bridge|tunnel|aeroway/.test(id)) set(l.id, "line-color", M.road);
      } else if (l.type === "symbol" && /shield/.test(id)) {   // road number plates: dark text on a light plate, dimmed at night
        set(l.id, "text-color", "#2b3a2f"); set(l.id, "icon-opacity", S.theme === "dark" ? 0.55 : 1);
      } else if (l.type === "symbol" && l.layout && l.layout["text-field"]) {
        set(l.id, "text-color", /water|sea|ocean/.test(id) ? M.waterText : M.text); set(l.id, "text-halo-color", M.bg);
      }
    });
  }

  function zoneFeatures() {
    return { type: "FeatureCollection", features: Object.entries(ZONE_GEO).map(([name, poly]) => {
      const zs = zoneShown(name), [col] = level(zs.pct);
      return { type: "Feature", properties: { name, color: col, on: name === S.zone ? 1 : 0, pct: zs.pct },
        geometry: poly.length > 1 ? { type: "MultiPolygon", coordinates: poly.map(p => [p]) } : { type: "Polygon", coordinates: poly } };
    }) };
  }

  // selected zone stronger; on the satellite photo all zones need a denser colour to stay visible
  const zoneOpacity = sat => ["case", ["==", ["get", "on"], 1], sat ? 0.7 : 0.6, sat ? 0.55 : 0.45];

  function addZones() {
    // zones go above all area fills (fields, town, buildings) but below roads and labels
    const layers = MAP.getStyle().layers;
    const lastFill = layers.map(l => l.type).lastIndexOf("fill");
    const before = layers[lastFill + 1] ? layers[lastFill + 1].id : undefined;
    MAP.addSource("zones", { type: "geojson", data: zoneFeatures() });
    MAP.addLayer({ id: "zones-fill", type: "fill", source: "zones", paint: { "fill-color": ["get", "color"], "fill-opacity": zoneOpacity(false) } }, before);
    MAP.addLayer({ id: "zones-line", type: "line", source: "zones", paint: { "line-color": zoneLineColor(), "line-width": ["case", ["==", ["get", "on"], 1], 3, 2.2], "line-dasharray": [3, 1.5] } }, before);
    // the sea goes on top of the zones, so it trims the approximate zone shapes at the shore
    layers.filter(l => l.type === "fill" && /water/.test(l.id)).forEach(l => MAP.moveLayer(l.id, before));
    MAP.on("click", "zones-fill", e => selectZone(e.features[0].properties.name));
    MAP.on("mouseenter", "zones-fill", () => { MAP.getCanvas().style.cursor = "pointer"; });
    MAP.on("mouseleave", "zones-fill", () => { MAP.getCanvas().style.cursor = ""; });
    Object.entries(ZONE_PIN).forEach(([name, ll]) => {
      const el = document.createElement("div");
      el.className = "zpin"; el.setAttribute("role", "button"); el.tabIndex = 0;
      el.addEventListener("click", ev => { ev.stopPropagation(); selectZone(name); });
      el.addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); selectZone(name); } });
      MARKERS[name] = { el, marker: new maplibregl.Marker({ element: el, anchor: "top" }).setLngLat(ll).addTo(MAP) };
    });
  }

  function updateRealMap() {
    if (!REAL) return;
    MAP.getSource("zones").setData(zoneFeatures());
    Object.entries(MARKERS).forEach(([name, { el }]) => {
      const zs = zoneShown(name), r = { matchPct: zs.pct }, [col] = level(zs.pct);
      el.classList.toggle("on", name === S.zone);
      el.style.setProperty("--c", col);
      el.setAttribute("aria-label", L().zoneAria(zname(name), r.matchPct));
      el.innerHTML = `<div class="pin"><i></i></div><span>${esc(pinLabel(name, zs))}</span>`;
    });
  }

  function fitReal(animate) {   // show all zones in the free part of the screen
    if (!REAL) return;
    const all = Object.values(ZONE_GEO).flat(2), lons = all.map(p => p[0]), lats = all.map(p => p[1]);
    const mobile = innerWidth <= 860, panelW = innerWidth > 1180 ? 444 : 404;
    const pad = mobile ? { top: 150, left: 24, right: 64, bottom: sheetPx() + 24 } : { top: 150, left: 60, right: panelW + 90, bottom: 80 };
    pad.bottom = Math.min(pad.bottom, innerHeight - pad.top - 60);
    MAP.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: pad, duration: animate ? 600 : 0, maxZoom: 14 });
  }

  function toggleSatellite() {
    SATON = !SATON;
    if (!MAP.getSource("sat")) {
      MAP.addSource("sat", { type: "raster", tiles: [toWeb(SAT.url)], tileSize: 256, attribution: SAT.attribution, maxzoom: 15 });
      MAP.addLayer({ id: "sat", type: "raster", source: "sat", layout: { visibility: "none" } }, "zones-fill");
    }
    // satellite: hide the drawn ground layers between the photo and the zones, keep labels and roads on top
    MAP.getStyle().layers.forEach(l => {
      if (l.id === "sat") MAP.setLayoutProperty("sat", "visibility", SATON ? "visible" : "none");
      else if (l.type === "fill" && !l.id.startsWith("zones")) MAP.setLayoutProperty(l.id, "visibility", SATON ? "none" : "visible");
    });
    MAP.setPaintProperty("zones-fill", "fill-opacity", zoneOpacity(SATON));
    $("satbtn").classList.toggle("on", SATON);
    $("satbtn").setAttribute("aria-pressed", SATON ? "true" : "false");
  }

  function selectZone(name) { S.zone = name; S.list = false; render(); }

  // Every map request goes through the "web://" protocol, which fetches on the main page (works inside
  // Streamlit's iframe, where the worker's own requests are unreliable).
  const WEB = "web://";
  const toWeb = u => (typeof u === "string" ? u.replace(/^https:\/\//, WEB) : u);
  async function loadStyle() {
    const style = await (await fetch(STYLE_URL)).json();
    for (const src of Object.values(style.sources)) {
      if (src.url) {                                   // TileJSON: read it here and inline the tile URLs
        const tj = await (await fetch(src.url)).json();
        ["tiles", "minzoom", "maxzoom", "bounds", "attribution"].forEach(k => { if (tj[k] !== undefined && src[k] === undefined) src[k] = tj[k]; });
        delete src.url;
      }
      if (src.tiles) src.tiles = src.tiles.map(toWeb);
    }
    style.glyphs = toWeb(style.glyphs);
    if (typeof style.sprite === "string") style.sprite = toWeb(style.sprite);
    else if (Array.isArray(style.sprite)) style.sprite.forEach(sp => { sp.url = toWeb(sp.url); });
    return style;
  }

  async function initRealMap() {
    if (!window.maplibregl) return;                       // no internet / CDN blocked: keep the illustrated map
    try {
      maplibregl.addProtocol("web", async (params, abort) => {
        const r = await fetch(params.url.replace(WEB, "https://"), { signal: abort.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return { data: params.type === "json" ? await r.json() : await r.arrayBuffer() };
      });
      if (location.origin === "null") {
        // Streamlit shows this page in a srcdoc iframe: its origin is "null", but MapLibre's worker (a blob URL)
        // gets the app's origin, and MapLibre drops messages whose origins differ. A data: URL worker also has
        // the "null" origin, so both sides match.
        const code = await (await fetch(maplibregl.getWorkerUrl())).text();
        maplibregl.setWorkerUrl("data:text/javascript;charset=utf-8," + encodeURIComponent(code));
      }
      const style = await loadStyle();
      MAP = new maplibregl.Map({ container: "realmap", style, center: [-0.81, 37.843], zoom: 12.3,
        attributionControl: false, dragRotate: false, pitchWithRotate: false, touchPitch: false });
    } catch (e) { MAP = null; return; }
    MAP.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
    MAP.touchZoomRotate.disableRotation();
    MAP.once("load", () => {
      try { restyle(); addZones(); } catch (e) { return; }
      REAL = true; document.body.classList.add("real");
      MAP.resize(); fitReal(false); updateRealMap();
    });
  }

  // ---------- language (EN / ES) ----------
  const langSwitch = () => `<span class="langsw" role="group" aria-label="${L().langLabel}"><i class="thumb" aria-hidden="true"></i>` +
    LANGS.map(l => `<button class="${S.lang === l ? "on" : ""}" data-act="lang" data-lang="${l}" aria-pressed="${S.lang === l}">${l.toUpperCase()}</button>`).join("") + `</span>`;
  function applyStatic() {   // texts written in index.html
    document.documentElement.lang = S.lang;
    document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = L()[el.dataset.i18n]; });
    document.querySelectorAll("[data-i18n-aria]").forEach(el => { el.setAttribute("aria-label", L()[el.dataset.i18nAria]); });
    const lb = document.querySelector(".lang-btn");
    lb.textContent = S.lang === "en" ? "ES" : "EN"; lb.setAttribute("aria-label", L().langLabel);
    document.querySelectorAll(".themebtn").forEach(b => b.setAttribute("aria-label", themeLabel()));
  }
  function setLang(l) {
    S.lang = l;
    try { localStorage.setItem("gr-lang", l); } catch (e) { /* storage blocked: the choice lasts for this visit */ }
    applyStatic(); render(); setPage(S.page, true);
  }

  // ---------- pages: Home, Map, Sources ----------
  const PAGES = ["home", "map", "sources"];
  const SUN = `<svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.3 4.3l1.6 1.6M18.1 18.1l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.3 19.7l1.6-1.6M18.1 5.9l1.6-1.6"/></svg>`;
  const MOON = `<svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7z"/></svg>`;
  const themeLabel = () => S.theme === "dark" ? L().themeLight : L().themeDark;
  const themeBtn = () => `<button class="themebtn" data-act="theme" aria-label="${themeLabel()}" aria-pressed="${S.theme === "dark"}">${SUN}${MOON}</button>`;
  const navHTML = (p = S.page) => themeBtn() + tabs(p) + langSwitch();
  function setTheme(t) {
    S.theme = t;
    try { localStorage.setItem("gr-theme", t); } catch (e) { /* storage blocked: the choice lasts for this visit */ }
    const root = document.documentElement;
    root.classList.add("theming"); root.dataset.theme = t;   // colours fade over for a moment
    setTimeout(() => root.classList.remove("theming"), 450);
    document.querySelectorAll(".themebtn").forEach(b => { b.setAttribute("aria-label", themeLabel()); b.setAttribute("aria-pressed", t === "dark"); });
    if (REAL) { restyle(); try { MAP.setPaintProperty("zones-line", "line-color", zoneLineColor()); } catch (e) { /* zones not added yet */ } }
  }
  const tabs = (cur = S.page) => `<span class="seg"><i class="thumb" aria-hidden="true"></i>` +
    PAGES.map(p => `<button class="${cur === p ? "on" : ""}" data-act="page" data-page="${p}"${cur === p ? ' aria-current="page"' : ""}>${L().tabs[p]}</button>`).join("") + `</span>`;
  const THUMB = {};   // where each menu slider (pages, language) was last drawn, so a change slides it from there
  function slideTabs(animate = true) {
    for (const kind of ["seg", "langsw"]) slideOne(kind, animate);
  }
  function slideOne(kind, animate) {
    let seen = null; const last = THUMB[kind];
    document.querySelectorAll(".tabs ." + kind).forEach(seg => {
      const on = seg.querySelector("button.on"), th = seg.querySelector(".thumb");
      if (!on || !on.offsetWidth) return;   // this menu is hidden right now
      const to = { x: on.offsetLeft, w: on.offsetWidth };
      th.style.transition = "none";
      if (animate && last) { th.style.transform = `translateX(${last.x}px)`; th.style.width = last.w + "px"; void th.offsetWidth; th.style.transition = ""; }
      th.style.transform = `translateX(${to.x}px)`; th.style.width = to.w + "px";
      if (!animate || !last) requestAnimationFrame(() => { th.style.transition = ""; });
      seen = to;
    });
    if (seen) THUMB[kind] = seen;
  }
  const topbar = () => `<div class="topbar"><div class="brand">${logoImg("logo")}Green Resilience</div><div class="navwrap">${themeBtn()}<nav class="tabs" aria-label="Main">${tabs()}${langSwitch()}</nav></div></div>`;
  const footer = () => `<div class="foot"><span>${L().footer}</span><span>${L().footData}</span></div>`;

  function bestPerZone(z) {   // best crop of a zone on the measured climate, each crop at its own best date
    const s0 = si(0, D.rain.indexOf(100));
    return D.crops.map(c => { const k = K(c.key, z), w = D.best[k][s0], x = D.rows[k][s0][w]; return { c, w, pct: x[F.pct], m: x[F.match] }; })
      .sort((a, b) => b.m - a.m)[0];
  }

  function renderHome() {
    const H = L().home, a = D.years[0];
    const pics = ["tomato", "olive", "melon", "lemon", "sea asparagus"].filter(k => PH[k]).slice(0, 3);
    const zones = D.zones.map(z => {
      const b = bestPerZone(z.name), [col] = level(b.pct), p = b.c;
      const when_ = p.perennial ? H.perennial : H.plantOn(fmt(wDate(b.w)));
      return `<button class="card zc" data-act="open" data-zone="${esc(z.name)}" data-crop="${esc(p.key)}">` +
        (PH[p.key] ? `<img src="${PH[p.key].src}" alt="">` : "") +
        `<div class="in"><div class="zn">${esc(zname(z.name))}</div><div class="cn">${esc(cname(p.key))}</div>` +
        `<span class="verdict" style="background:${col}">${b.pct}% · ${VERDICT(b.pct)}</span>` +
        `<div class="mini">${H.zoneLine(when_, nf(z.soil.ph, 1), dec(z.ece))}</div><div class="go">${H.openOnMap}</div></div></button>`;
    }).join("");
    const icons = ["🌡", "💧", "🧂", "⚗"];
    $("home").innerHTML = `<div class="wrap">${topbar()}
      <div class="hero"><div><span class="eyebrow">${H.eyebrow}</span><h1>${H.h1}</h1><p class="lead">${H.lead}</p>
        <div class="cta"><button class="btn primary" data-act="page" data-page="map">${H.openMap}</button><button class="btn ghost" data-act="page" data-page="sources">${H.dataBtn}</button></div></div>
        <div class="mosaic">${pics.map(k => `<img src="${PH[k].src}" alt="${esc(cname(k))}">`).join("")}</div></div>
      <div class="h2">${H.bestTitle}</div><p class="sub">${H.bestSub(a, LAST_YEAR)}</p><div class="grid3">${zones}</div>
      <div class="h2">${H.howTitle}</div><p class="sub">${H.howSub}</p>
      <div class="grid3">${H.steps.map(([t, d], i) => `<div class="card"><span class="num">${i + 1}</span><h3>${t}</h3><p>${d}</p></div>`).join("")}</div>
      <div class="h2">${H.lookTitle}</div><p class="sub">${H.lookSub}</p>
      <div class="grid4">${H.factors.map(([t, d], i) => `<div class="card factor"><b>${icons[i]}</b><div><h3>${t}</h3><p>${d}</p></div></div>`).join("")}</div>
      <div class="h2">${H.openTitle}</div><p class="sub">${H.openSub} <button class="linkbtn" data-act="page" data-page="sources">${H.allSources}</button></p>
      <div class="chips2">${H.chips(a, LAST_YEAR).map(x => `<span>${x}</span>`).join("")}</div>
      ${footer()}</div>`;
  }

  function renderSources() {
    const R = L().src, a = D.years[0];
    const ref = (text, url, note) => `<li>${text}${url ? ` <a href="${url}" target="_blank" rel="noopener">${esc(url.replace(/^https?:\/\//, ""))}</a>` : ""}${note ? `<small>${note}</small>` : ""}</li>`;
    const photos = Object.entries(PH).map(([k, v]) => ref(`${esc(cname(k))}: ${esc(v.credit.replace(/^Photo: /, ""))}.`, v.source, "")).join("");
    $("sources").innerHTML = `<div class="wrap">${topbar()}
      <div class="h2">${R.title}</div><p class="sub">${R.sub}</p>
      <div class="bib">
        <div class="card"><h3>${R.satellite}</h3><ol>
          ${ref("Reichle, R. et al. <i>SMAP L4 Global 3-hourly 9 km EASE-Grid Surface and Root Zone Soil Moisture Geophysical Data</i>, Version 8 (SPL4SMGP). NASA National Snow and Ice Data Center DAAC.", "https://www.earthdata.nasa.gov/data/catalog/nsidc-cprd-spl4smgp-008-0", R.smapNote)}
        </ol></div>
        <div class="card"><h3>${R.stations}</h3><ol>
          ${ref("Ministerio de Agricultura, Pesca y Alimentación (MAPA). <i>SiAR – Sistema de Información Agroclimática para el Regadío</i>.", "https://servicio.mapa.gob.es/siarweb/", R.siarNote(a, LAST_YEAR))}
        </ol></div>
        <div class="card"><h3>${R.soil}</h3><ol>
          ${ref("Poggio, L. et al. (2021). SoilGrids 2.0: producing soil information for the globe with quantified spatial uncertainty. <i>SOIL</i> 7, 217–240. ISRIC – World Soil Information.", "https://soilgrids.org", R.sgNote)}
          ${ref(R.salinity, "", "")}
        </ol></div>
        <div class="card"><h3>${R.crops}</h3><ol>
          ${ref(R.bioTable, "", "")}
          ${ref("Allen, R.G., Pereira, L.S., Raes, D. &amp; Smith, M. (1998). <i>Crop evapotranspiration – Guidelines for computing crop water requirements</i>. FAO Irrigation and Drainage Paper 56.", "https://www.fao.org/4/x0490e/x0490e00.htm", R.fao56Note)}
          ${ref("Tanji, K.K. &amp; Kielen, N.C. (2002). <i>Agricultural drainage water management in arid and semi-arid areas</i>. FAO Irrigation and Drainage Paper 61.", "https://www.fao.org/4/y4263e/y4263e00.htm", R.fao61Note)}
          ${ref("Maas, E.V. &amp; Hoffman, G.J. (1977). Crop salt tolerance – current assessment. <i>Journal of the Irrigation and Drainage Division</i> 103(2), 115–134.", "", R.maasNote)}
          ${ref("Glenn, E.P. et al. (1997). Water requirements for cultivating <i>Salicornia bigelovii</i> with seawater on sand in a coastal desert environment. <i>Journal of Arid Environments</i>.", "https://experts.arizona.edu/en/publications/water-requirements-for-cultivating-salicornia-bigelovii-torr-with/", "")}
          ${ref("Water requirement and crop coefficient of two <i>Salicornia</i> species in Yazd. <i>Water Research in Agriculture</i> (AREEO).", "https://journals.areeo.ac.ir/article_122582.html?lang=en", R.yazdNote)}
          ${ref("Growing degree days: Midwestern Regional Climate Center (Purdue University).", "https://mrcc.purdue.edu/resources/growing-degree-day-description", R.gddNote)}
        </ol></div>
        <div class="card"><h3>${R.map}</h3><ol>
          ${ref("© OpenStreetMap contributors (ODbL).", "https://www.openstreetmap.org/copyright", "")}
          ${ref("OpenFreeMap vector tiles, based on OpenMapTiles.", "https://openfreemap.org", "")}
          ${ref("MapLibre GL JS.", "https://maplibre.org", "")}
          ${ref("Sentinel-2 cloudless 2023 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2023), CC BY-NC-SA 4.0.", "https://s2maps.eu", "")}
        </ol></div>
        <div class="card"><h3>${R.photos}</h3><p class="sub" style="margin:0 0 8px">${R.photosNote}</p><ol>${photos}</ol></div>
        <div class="card"><h3>${R.ai}</h3><ol>
          ${ref("Claude Code (Anthropic).", "https://claude.com/claude-code", R.aiNote)}
        </ol></div>
      </div>${footer()}</div>`;
  }

  // ---------- page change: our logo (tree + rocket) draws itself while the next page is prepared ----------
  const playTransition = (() => {
    const ld = $("ld"), rm = matchMedia("(prefers-reduced-motion: reduce)");
    const leaf = (x, y, a, d) => `<g transform="translate(${x} ${y}) rotate(${a})"><path class="lf" style="--d:${d}s" d="M0 0C3 -5.5 10 -5.5 13.5 0C10 5.5 3 5.5 0 0Z"/></g>`;
    const half = `<path class="dr" pathLength="1" style="--d:.04s" d="M97 96V138C97 151 88 158 68 158"/>
<path class="dr" pathLength="1" style="--d:.14s" d="M97 134C97 118 82 114 73 106C65 99 67 91 73 86C78 81 77 74 73 70"/>
${leaf(73, 70, -125, .34)}${leaf(75, 77, -38, .38)}${leaf(69, 92, -178, .42)}${leaf(67, 104, 158, .46)}${leaf(81, 114, 142, .5)}`;
    ld.innerHTML = `<svg viewBox="0 0 200 200"><circle class="bd" cx="100" cy="100" r="96"/>
<path class="dr" pathLength="1" style="--d:.02s" d="M66 158H134"/>
<g>${half}</g><g transform="translate(200 0) scale(-1 1)">${half}</g>
<circle class="sr" cx="68" cy="59" r="6"/>
<path class="sm" d="M139 35A13 13 0 1 0 152 52A10 10 0 1 1 139 35Z"/>
<path class="fl2" d="M95 96H105L100 120Z"/>
<path class="rk2" d="M100 38C93 46 88 56 88 70V80C83 84 81 89 81 95L88 94L92 97V92H108V97L112 94L119 95C119 89 117 84 112 80V70C112 56 107 46 100 38Z"/></svg>`;
    let busy = false;
    // playTransition(fn): shows the animation, runs fn() while the screen is covered, then fades out (~0.9 s)
    return onSwap => {
      if (busy) return; busy = true; const sw = rm.matches ? 120 : 620;
      ld.className = ""; void ld.offsetWidth; ld.className = "on";
      setTimeout(() => { try { if (onSwap) onSwap(); } finally { /* always fade out */ } }, sw);
      setTimeout(() => ld.classList.add("out"), sw + 50);
      setTimeout(() => { ld.className = ""; busy = false; }, sw + 50 + 230);
    };
  })();
  function goPage(p, before) {   // menu pill slides at once; the page itself changes under the logo animation
    if (p === S.page && !before) return;
    $("mapnav").innerHTML = navHTML(p); slideTabs();
    playTransition(() => { if (before) { before(); render(); } setPage(p); });
  }
  function setPage(p, keepScroll) {
    S.page = p;
    document.body.classList.remove("page-home", "page-map", "page-sources");
    document.body.classList.add("page-" + p);
    if (p === "home") renderHome();
    if (p === "sources") renderSources();
    $("mapnav").innerHTML = navHTML();   // one menu, centred, same place on every page
    slideTabs();
    if ((p === "home" || p === "sources") && !keepScroll) $(p).scrollTop = 0;
    if (p === "map" && REAL) { MAP.resize(); fitReal(false); }
  }

  // ---------- top bar ----------
  function renderTop() {
    const T_ = L();
    $("cropchip").textContent = cname(S.crop);
    $("seasons").innerHTML = ["best", ...Object.keys(SEASONS)].map(m => `<button class="chip${S.mode === m ? " on" : ""}" data-act="mode" data-mode="${m}">${T_.seasons[m]}</button>`).join("");
    const list = $("croplist");
    list.hidden = !S.list;
    if (S.list) {
      list.innerHTML = `<div class="hint">${esc(T_.matchIn(zname(S.zone)))}</div>` + D.crops.map(c => {
        const r = res(c.key, S.zone, weekFor(c.key, S.zone)), [col] = level(r.matchPct);
        const img = PH[c.key] ? `<img src="${PH[c.key].src}" alt="">` : `<span class="ph">${esc(cname(c.key)[0])}</span>`;
        return `<button class="opt${c.key === S.crop ? " on" : ""}" role="option" data-act="crop" data-crop="${esc(c.key)}">${img}<span class="nm">${esc(cname(c.key))}</span><span class="pct" style="background:${col}">${r.matchPct}%</span></button>`;
      }).join("");
    }
    const lb = $("lensbtn");
    lb.textContent = shifted() ? T_.lensActive(warm(), D.rain[S.iR]) : T_.lensBtn;
    lb.classList.toggle("active", shifted());
    $("lens").hidden = !S.lens;
    $("sT").value = S.iT; $("sR").value = S.iR;
    $("vT").textContent = `+${warm()} °C`; $("vR").textContent = T_.rainOf(D.rain[S.iR]);
  }

  // ---------- farmer view helpers ----------
  const VERDICT = p => L().verdict[p >= 70 ? 0 : p >= 40 ? 1 : 2];
  const status = v => (v >= D.good_score ? [C.olive, L().status[0]] : v >= 0.4 ? [C.amber, L().status[1]] : [C.red, L().status[2]]);
  const m3 = mm => (Math.round(mm) * 10).toLocaleString(L().locale);          // 1 mm = 10 m³ per hectare
  const when = d => L().when(d.getUTCDate() <= 10 ? 0 : d.getUTCDate() <= 20 ? 1 : 2, L().monFull[d.getUTCMonth()]);
  const q = kind => `<button class="qbtn" data-act="info" data-info="${kind}" aria-label="${L().qAria}">?</button>`;
  const cap = s => s[0].toUpperCase() + s.slice(1);
  function monthWeek(c, z, m) {   // best planting week inside month m (1-12)
    const rows = rowsOf(c, z); let best = -1, bw = -1;
    D.weeks.forEach((_, w) => { if (month(w) === m && rows[w][F.match] > best) { best = rows[w][F.match]; bw = w; } });
    return bw;
  }

  function calendarBlock(c, z, p, r) {
    const T_ = L(), rows = rowsOf(c, z), harvestM = r.harvest.getUTCMonth() + 1, plantM = r.plant.getUTCMonth() + 1;
    const cells = MON().map((name, i) => {
      const m = i + 1, w = monthWeek(c, z, m), v = rows[w][F.pct], allowed = p.months.includes(m), [col] = level(v);
      const cls = [allowed ? "" : "out", m === plantM ? "sel" : "", m === harvestM && !p.perennial ? "hv" : ""].join(" ").trim();
      return `<button class="${cls}" style="background:${col}" data-act="month" data-month="${m}" title="${T_.monthTitle(cap(T_.monFull[i]), v, allowed)}">${name[0].toUpperCase()}</button>`;
    }).join("");
    const txt = p.perennial ? T_.perennialTxt(fmt(r.plant)) : T_.plantTxt(when(r.plant), when(r.harvest), r.cycle);
    return `<div class="block"><div class="block-h"><span>📅 ${T_.whenToPlant}</span>${q("calendar")}</div>` +
      `<div class="cal">${cells}</div><div class="cal-txt">${txt}${r.inMonths ? "" : ` <em>${T_.outsideMonths}</em>`}</div></div>`;
  }

  function factRows(p, r, zz) {
    const T_ = L(), [tc, ts] = status(r.temp), [wc, ws] = status(r.water), soilScore = Math.min(r.salt, r.ph), [sc_, ss] = status(soilScore);
    const a = dec(p.t_min), b = dec(p.t_max);
    let tTxt;
    if (r.gdd < 99) tTxt = T_.tGdd(r.gdd);
    else if (r.frost + r.heat >= 5) tTxt = T_.tExtreme(r.frost, r.heat);
    else if (r.temp >= D.good_score) {   // good score: calm wording, mention a mild issue only
      const mild = Math.max(r.cold, r.hot) >= 15 ? (r.cold >= r.hot ? T_.tMildCold(r.cold) : T_.tMildHot(r.hot)) : "";
      tTxt = T_.tGood(nf(r.meanT, 0), a, b, mild);
    } else tTxt = r.cold >= r.hot ? T_.tCold(r.cold, a, b) : T_.tHot(r.hot, a, b);
    const covered = Math.min(100, Math.round(100 * (r.effRain + r.soilWater) / Math.max(1, r.cropWater)));
    const wTxt = r.irr >= 1 ? T_.wIrr(m3(r.irr), r.irr, covered, r.usesSeawater) : T_.wNone;
    const salt = r.needsSaline ? T_.sNeedsSaline : r.usesSeawater ? T_.sSeawater : r.saltDrop > 0 ? T_.sCut(r.saltDrop) : T_.sFine;
    const ph = r.ph < 1 ? T_.phPref(nf(r.soilPh, 1), dec(p.ph_opt[0]), dec(p.ph_opt[1])) : T_.phFine(nf(r.soilPh, 1));
    const row = (kind, icon, label, v, col, word, txt) => `<div class="fact">${ring(40, v, col, icon, 44, 18, 5, 15)}` +
      `<div class="fact-t"><b>${label}<em style="color:${col}">· ${word}</em></b>${txt}</div>${q(kind)}</div>`;
    return `<div class="block"><div class="block-h"><span>${T_.whyScore}</span></div><div class="facts">` +
      row("temp", "🌡", T_.temperature, r.temp, tc, ts, tTxt) + row("water", "💧", T_.water, r.water, wc, ws, wTxt) +
      row("soil", "🧂", T_.soil, soilScore, sc_, ss, `${cap(salt)} · ${ph}.`) + `</div></div>`;
  }

  function otherCrops(c, z) {
    const T_ = L(), ranked = D.crops.map(cc => ({ c: cc, r: res(cc.key, z, weekFor(cc.key, z)) })).sort((x, y) => y.r.match - x.r.match);
    const top = ranked.filter(x => x.c.key !== c).slice(0, 3);
    const card = ({ c: cc, r }) => { const [col] = level(r.matchPct);
      return `<button class="tc" data-act="crop" data-crop="${esc(cc.key)}">${PH[cc.key] ? `<img src="${PH[cc.key].src}" alt="">` : `<span class="ph"></span>`}<b>${esc(cname(cc.key))}</b><span style="background:${col}">${r.matchPct}%</span></button>`; };
    let h = `<div class="block"><div class="block-h"><span>${esc(T_.otherCrops(zname(z)))}</span></div><div class="top3">${top.map(card).join("")}</div>`;
    if (S.allCrops) h += `<div class="rank">` + ranked.map(({ c: cc, r }) => `<button class="rk" data-act="crop" data-crop="${esc(cc.key)}"><span>${esc(cname(cc.key))}</span><span class="bar"><i style="width:${Math.max(1, r.match * 100)}%;background:${cc.key === c ? C.teal : C.light}"></i></span><b>${r.matchPct}%</b></button>`).join("") + `</div>`;
    return h + `<button class="linkbtn" data-act="allcrops">${S.allCrops ? T_.showFewer : T_.compareAll}</button></div>`;
  }

  // ---------- season catalogue: best crops to plant in a season, in the chosen zone ----------
  const SEASON_ICON = { Spring: "🌱", Summer: "☀️", Autumn: "🍂", Winter: "❄️" };
  function seasonCatalog(z, season) {   // every crop at its best week of the season, best first
    const ms = SEASONS[season];
    const list = D.crops.map(c => { const w = seasonWeek(c.key, z, season); return { c, r: res(c.key, z, w), ok: c.months.some(m => ms.includes(m)) }; })
      .sort((a, b) => b.r.match - a.r.match);
    return { ok: list.filter(x => x.ok), other: list.filter(x => !x.ok) };   // ok = usually planted in that season
  }
  function zoneShown(name) {   // what the map shows for a zone: the chosen crop, or the season's best crop
    if (S.view === "season" && SEASONS[S.mode]) {
      const top = seasonCatalog(name, S.mode).ok[0];
      if (top) return { pct: top.r.matchPct, crop: top.c.key };
    }
    return { pct: res(S.crop, name, weekFor(S.crop, name)).matchPct, crop: null };
  }
  function pinLabel(name, zs) {
    const small = innerWidth <= 860, z = small ? zshort(name) : zname(name);
    return zs.crop && !small ? L().pinSeason(z, cname(zs.crop), zs.pct) : `${z} · ${zs.pct}%`;
  }
  function renderSeasonPanel() {
    const T_ = L(), z = S.zone, s = S.mode, sn = T_.seasons[s], cat = seasonCatalog(z, s);
    const item = ({ c, r }, rank) => {
      const [col] = level(r.matchPct), water = r.irr >= 1 ? T_.catIrr(m3(r.irr)) : T_.catNoIrr;
      const line = c.perennial ? T_.catPerennial(water) : T_.catLine(when(r.plant), when(r.harvest), water);
      return `<button class="ci" data-act="seasoncrop" data-crop="${esc(c.key)}"><span class="rk1">${rank}</span>` +
        (PH[c.key] ? `<img src="${PH[c.key].src}" alt="">` : `<span class="ph"></span>`) +
        `<span class="ct"><b>${esc(cname(c.key))}</b>${VERDICT(r.matchPct)} · ${esc(line)}</span>` +
        `<span class="pct" style="background:${col}">${r.matchPct}%</span></button>`;
    };
    let h = `<div class="cat-h"><span class="cat-ic" aria-hidden="true">${SEASON_ICON[s]}</span><div class="title">${esc(sn)} <span>(${esc(zname(z))})</span></div></div>`;
    h += `<p class="cat-sub">${esc(T_.catSub(sn, T_.seasonMonths[s], zname(z)))}</p>`;
    if (shifted()) h += `<div class="banner shift">${esc(T_.lensActive(warm(), D.rain[S.iR]))}</div>`;
    h += cat.ok.length ? `<div class="cat">${cat.ok.map((x, i) => item(x, i + 1)).join("")}</div>` : `<p class="mini">${T_.catNone}</p>`;
    if (cat.other.length) {
      h += `<button class="toggle" data-act="seasonother" aria-expanded="${S.seasonOther}">${esc(T_.catOther(sn, cat.other.length))} <span>${S.seasonOther ? "▴" : "▾"}</span></button>`;
      if (S.seasonOther) h += `<div class="cat dim">${cat.other.map(x => item(x, "·")).join("")}</div>`;
    }
    h += `<p class="note">${T_.catNote(D.years[0], LAST_YEAR)}</p>`;
    $("panelBody").innerHTML = h;
    $("info").hidden = true;
  }

  // ---------- "?" cards: how each answer is calculated, with this crop's own numbers ----------
  function infoCard(kind) {
    const T_ = L(), I = T_.li, c = S.crop, z = S.zone, p = crop(c), w = weekFor(c, z), r = res(c, z, w), zz = zone(z), st = zz.stations.join(" + ");
    const li = rows => `<ul class="nums">${rows.map(([a, b]) => `<li><span>${a}</span><b>${b}</b></li>`).join("")}</ul>`;
    const src = s => `<div class="src">${T_.sources}: ${s}</div>`;
    const years = `${D.years[0]}–${LAST_YEAR}`, K_ = T_.card;
    const cards = {
      match: () => [K_.match[0], K_.match[1] + `<div class="formula">${K_.match[2]}</div>` +
        li([[I.temperature, pct(r.temp) + "%"], [I.water, pct(r.water) + "%"], [I.salinity, pct(r.salt) + "%"], [I.phFactor, nf(r.ph, 2)], [I.matchAvg(D.years.length), r.matchPct + "%"], [I.yieldIdx, r.yld + "%"]]) +
        K_.match[3] + src(K_.match[4](years))],
      calendar: () => [K_.calendar[0], K_.calendar[1] +
        (p.gdd ? K_.calendar[2] + `<div class="formula">${K_.calendar[3](dec(p.t_base), p.gdd)}</div>` +
          li([[I.planting, fmt(r.plant)], [I.heatReached, r.gdd + "%"], [I.season, I.days(r.cycle)], [I.harvest, fmt(r.harvest, true)]]) + K_.calendar[4]
          : li([[I.planting, fmt(r.plant)], [I.season, I.fixed(r.cycle, p.perennial)]])) + src(K_.calendar[5](st, years))],
      temp: () => [K_.temp[0], K_.temp[1](dec(p.t_max + 10)) + `<div class="formula">${K_.temp[2](!!p.gdd)}</div>` +
        li([[I.comfort, `${dec(p.t_min)}–${dec(p.t_max)} °C`], [I.avgSeason, nf(r.meanT, 1) + " °C"], [I.belowAbove, `${r.cold}% / ${r.hot}%`], [I.frostHeat, `${r.frost}% / ${r.heat}%`], [I.tScore, pct(r.temp) + "%"]]) +
        src(K_.temp[3](st, years, zz.dT_summer ? dec(zz.dT_summer) : 0))],
      water: () => [K_.water[0], K_.water[1] + `<div class="formula">${K_.water[2]}</div>` +
        `<div class="stack">${[[r.effRain, C.sea], [Math.min(r.soilWater, Math.max(0, r.cropWater - r.effRain)), C.brown], [r.irr, C.teal]].map(([v, col]) => v > 0 ? `<span style="width:${(v / Math.max(1, r.cropWater) * 100).toFixed(1)}%;background:${col}"></span>` : "").join("")}</div>` +
        `<div class="legend">${[C.sea, C.brown, C.teal].map((col, i) => `<span>${dot(col)}${K_.water[3][i]}</span>`).join("")}</div>` +
        li([[I.kc, p.kc.map(dec).join(" – ")], [I.cropUse, r.cropWater + " mm"], [I.effOf(r.rain), r.effRain + " mm"], [I.soilAt, r.soilWater + " mm"], [I.irr, `${r.irr} mm = ${m3(r.irr)} m³/ha`], [I.wScore, pct(r.water) + "%"]]) +
        K_.water[4] + src(K_.water[5](st, years, dec(p.root_m)))],
      soil: () => [K_.soil[0], K_.soil[1] + `<div class="formula">${K_.soil[2]}</div>` +
        `<div class="phbar"><span class="tol" style="left:${phx(p.ph_tol[0])}%;width:${phx(p.ph_tol[1]) - phx(p.ph_tol[0])}%"></span><span class="opt" style="left:${phx(p.ph_opt[0])}%;width:${phx(p.ph_opt[1]) - phx(p.ph_opt[0])}%"></span><span class="mark" style="left:${phx(zz.soil.ph)}%"></span></div>` +
        `<div class="phscale">${[4, 5, 6, 7, 8, 9].map(v => `<span style="left:${phx(v)}%">${v}</span>`).join("")}</div>` +
        li([[I.ece, dec(zz.ece) + " dS/m"], [I.thr, dec(p.ece_threshold) + " dS/m"], [I.sScore, pct(r.salt) + "%"], [I.phBest, `${nf(zz.soil.ph, 1)} / ${p.ph_opt.map(dec).join("–")}`], [I.phFactor, nf(r.ph, 2)], [I.soilType, `${texture(zz.soil.texture)}, ${dec(zz.soil.soc_g_kg)} ${I.carbon}`]]) +
        (zz.saline_water_available ? K_.soil[3](esc(T_.salineLabel || D.saline_label)) : "") + src(K_.soil[4])],
      shift: () => [K_.shift[0], K_.shift[1] + `<div class="formula">${K_.shift[2](warm(), D.rain[S.iR], Math.round(D.et0_per_c * 100 * warm()))}</div>` +
        li([[K_.shift[3], `${r.basePct}% → ${r.matchPct}%`]]) + src(K_.shift[4])],
    };
    const [title, body] = cards[kind]();
    return `<button class="close" data-act="closeinfo" aria-label="${T_.close}">×</button><h3 id="infoTitle">${title}</h3>${body}`;
  }
  const phx = v => ((Math.min(9.5, Math.max(4, v)) - 4) / 5.5 * 100).toFixed(1);

  // Warning under the explanation: the model's own words in English, the same rule in Spanish
  function warningText(p, r) {
    if (S.lang === "en") return r.warning;
    if (r.ph < 0.5) return L().warnPh(cname(p.key), dec(p.ph_opt[0]), dec(p.ph_opt[1]), nf(r.soilPh, 1), nf(r.ph, 1));
    return r.needsSaline ? L().warnSaline : "";
  }

  // ---------- result panel ----------
  function renderPanel() {
    if (S.view === "season" && SEASONS[S.mode]) { renderSeasonPanel(); return; }
    const T_ = L(), c = S.crop, z = S.zone, p = crop(c), w = weekFor(c, z), r = res(c, z, w), [col] = level(r.matchPct), a = D.years[0];
    let h = (SEASONS[S.mode] ? `<button class="backlink" data-act="seasonlist">${esc(T_.backTo(T_.seasons[S.mode]))}</button>` : "") +
      `<div class="hdr"><button data-act="info" data-info="match" aria-label="${T_.qAria}" style="padding:0">${ring(64, r.match, col, r.matchPct + "%", 56, 22, 6, 14)}</button>` +
      `<div><div class="title">${esc(cname(c))} <span>(${esc(zname(z))})</span></div><span class="verdict" style="background:${col}">${VERDICT(r.matchPct)}</span></div></div>`;
    if (PH[c]) h += `<figure class="photo"><img src="${PH[c].src}" alt="${esc(cname(c))}"><figcaption>${esc(PH[c].credit.replace(/^Photo/, T_.photoWord))}</figcaption></figure>`;
    h += `<p class="desc">${esc(explain(p, r))}</p>`;
    const warn = warningText(p, r);
    if (warn) h += `<div class="banner">⚠ ${esc(warn)}</div>`;
    h += calendarBlock(c, z, p, r) + factRows(p, r, zone(z));
    if (shifted()) {
      const base = rowsOf(c, z, si(0, D.rain.indexOf(100)))[w], dIrr = r.irr - base[F.irr];
      h += `<div class="shiftline"><span>${T_.shiftLine(warm(), D.rain[S.iR], r.basePct, r.matchPct, (dIrr >= 0 ? "+" : "−") + m3(Math.abs(dIrr)))}</span>${q("shift")}</div>`;
    }
    h += otherCrops(c, z);
    h += `<button class="expert" data-act="expert" aria-expanded="${S.expert ? "true" : "false"}">${T_.howCalc} <span>${S.expert ? "▴" : "▾"}</span></button>`;
    if (S.expert) {
      h += `<div class="expert-body"><p class="mini">${T_.expertIntro(D.years.length)}</p>`;
      h += waterCard(p, r) + heatCard(p, r);
      h += `<div class="sec">${T_.rvTitle} <small>· ${T_.rvSub}</small></div>${monthlyChart(z)}`;
      h += `<div class="sec">${T_.wkTitle} <small>· ${T_.wkSub}</small></div>${weeksChart(c, z, w)}`;
      h += `<div class="sec">${T_.clTitle} <small>· ${T_.clSub}</small></div>${climateChart(c, z, r)}`;
      h += `<p class="note">${p.assumed ? T_.noteAssumed(esc(p.notes)) : ""}${T_.noteTown(LAST_YEAR)}</p>`;
      h += `<div class="sources">${T_.srcChips(a, LAST_YEAR).map(x => `<span>${x}</span>`).join("")}</div>`;
      h += `<div class="limits"><b>${T_.limitsTitle}</b><ul>${T_.limits(a, LAST_YEAR).map(x => `<li>${x}</li>`).join("")}</ul></div>`;
      h += `<div class="credits">${T_.photosVia} ` + Object.entries(PH).map(([k, v]) => `<a href="${esc(v.source)}" target="_blank" rel="noopener">${esc(cname(k))}</a> (${esc(v.short)})`).join(", ") + `.</div></div>`;
    }
    $("panelBody").innerHTML = h;
    const info = $("info");
    info.hidden = !S.info;
    if (S.info) info.innerHTML = infoCard(S.info);
  }

  function render() {
    renderTop();
    if (REAL) updateRealMap(); else { fitView(); $("map").innerHTML = mapSVG(); }
    renderPanel();
  }

  // ---------- events ----------
  document.addEventListener("click", e => {
    const el = e.target.closest("[data-act]");
    if (!el) { if (S.list) { S.list = false; renderTop(); } return; }
    const act = el.dataset.act;
    if (act === "lang") { setLang(el.dataset.lang || (S.lang === "en" ? "es" : "en")); return; }
    if (act === "theme") { setTheme(S.theme === "dark" ? "light" : "dark"); return; }
    if (act === "page") { goPage(el.dataset.page); return; }
    if (act === "open") { const { crop: c, zone: z } = el.dataset; goPage("map", () => { S.crop = c; S.zone = z; S.mode = "best"; S.view = "crop"; S.info = null; }); return; }
    if (act === "list") { S.list = !S.list; S.lens = false; renderTop(); return; }
    if (act === "crop") { S.crop = el.dataset.crop; S.list = false; S.info = null; S.view = "crop"; }
    else if (act === "zone") { S.zone = el.dataset.zone; S.list = false; }
    else if (act === "mode") { S.mode = el.dataset.mode; S.view = S.mode === "best" ? "crop" : "season"; S.info = null; S.seasonOther = false; }
    else if (act === "seasoncrop") { S.crop = el.dataset.crop; S.view = "crop"; S.info = null; }
    else if (act === "seasonlist") { S.view = "season"; S.info = null; }
    else if (act === "seasonother") { S.seasonOther = !S.seasonOther; }
    else if (act === "week") { S.mode = "week"; S.week = +el.dataset.w; }
    else if (act === "year") { S.year = +el.dataset.year; }
    else if (act === "month") { const m = +el.dataset.month; S.mode = "week"; S.week = monthWeek(S.crop, S.zone, m); }
    else if (act === "info") { S.info = el.dataset.info; if (innerWidth <= 860) { S.sheet = "full"; applySheet(); } }
    else if (act === "closeinfo") { S.info = null; }
    else if (act === "expert") { S.expert = !S.expert; }
    else if (act === "allcrops") { S.allCrops = !S.allCrops; }
    else if (act === "zoom") { if (REAL) MAP.zoomIn(); else S.zoom = Math.min(S.zoom * 1.3, 2.6); }
    else if (act === "locate") { if (REAL) fitReal(true); else S.zoom = 1; }
    else if (act === "sat") { if (REAL) toggleSatellite(); return; }
    else if (act === "lens") { S.lens = !S.lens; S.list = false; }
    else if (act === "reset") { S.iT = 0; S.iR = D.rain.indexOf(100); }
    const scroll = $("panelBody").scrollTop;
    render();
    if (["year", "week", "month", "info", "closeinfo", "expert", "allcrops", "seasonother"].includes(act)) $("panelBody").scrollTop = scroll;   // keep the reader's place
    if (["mode", "seasoncrop", "seasonlist"].includes(act)) $("panelBody").scrollTop = 0;                 // a new view starts at the top
  });
  document.addEventListener("keydown", e => {
    if ((e.key === "Enter" || e.key === " ") && e.target.classList && e.target.classList.contains("zone")) { e.preventDefault(); e.target.dispatchEvent(new MouseEvent("click", { bubbles: true })); }
    if (e.key === "Escape") { S.list = false; S.lens = false; S.info = null; render(); }
  });
  $("sT").addEventListener("input", e => { S.iT = +e.target.value; render(); });
  $("sR").addEventListener("input", e => { S.iR = +e.target.value; render(); });
  addEventListener("resize", () => { applySheet(); render(); slideTabs(false); if (REAL) { MAP.resize(); fitReal(false); } });
  if (document.fonts) document.fonts.ready.then(() => slideTabs(false));   // web fonts change the button widths

  // bottom sheet (phones): drag or tap the handle -> peek / half / full
  // After a tap on the handle the sheet changes size, and the phone's click from that same tap would
  // land on whatever is under the finger now (e.g. a "?" button). That one click is ignored.
  let ignoreClickUntil = 0;
  document.addEventListener("click", e => {
    if (Date.now() < ignoreClickUntil) { e.preventDefault(); e.stopPropagation(); ignoreClickUntil = 0; }
  }, true);
  function applySheet() { $("panel").style.setProperty("--sheet-h", sheetPx() + "px"); }
  (function sheetDrag() {
    const hd = $("handle"), panel = $("panel");
    // a click listener makes the phone browser treat the handle as a button, so a slightly
    // inaccurate tap stays on the handle instead of snapping to the "?" button just below it
    hd.addEventListener("click", e => e.stopPropagation());
    hd.addEventListener("keydown", e => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault(); const order = ["peek", "half", "full"];
      S.sheet = order[(order.indexOf(S.sheet) + 1) % 3]; applySheet(); render(); if (REAL) fitReal(true);
    });
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
      y0 = null; ignoreClickUntil = Date.now() + 450; applySheet(); render(); if (REAL) fitReal(true);
    });
  })();

  document.querySelector(".home-btn").innerHTML = logoImg("");
  document.querySelector(".ctl.themebtn").innerHTML = SUN + MOON;
  applyStatic();
  applySheet();
  render();
  setPage("home");
  initRealMap();
  window.__cropMatch = { res, explain, crop, D, S, map: () => MAP, setLang, render, infoCard, renderHome, renderSources, seasonCatalog };   // used by the checks
})();
