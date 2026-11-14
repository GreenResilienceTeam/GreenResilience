// Crop Match UI logic. All scores come from data/ui_data.json (made by export_ui_data.py,
// which runs scoring.py). This file only looks results up and draws them.
(function () {
  "use strict";
  const D = JSON.parse(document.getElementById("data").textContent);
  const PH = JSON.parse(document.getElementById("photos").textContent);

  // Palette from the design files
  const C = { olive: "#8d9f53", olive2: "#95a750", teal: "#62958e", amber: "#d9a441", sea: "#84abc8",
    aqua: "#6da7a7", sand: "#d9d0ba", track: "#e1e6d3", light: "#b9c1ab", red: "#b9603e", ink: "#2b3a2f" };
  const SEASONS = { Spring: [3, 4, 5], Summer: [6, 7, 8], Autumn: [9, 10, 11], Winter: [12, 1, 2] };
  // Map polygons from the desktop design, grouped into the three model zones (positions are illustrative)
  const ZONE_MAP = {
    "Inland farmland": { pin: [300, 476], label: [300, 536], polys: [["M300 380l60-30 30 50-50 40z", .45], ["M370 420l92-48 52 70-84 56z", .65], ["M400 500l100-40 56 60-80 60z", .55]] },
    "Town": { pin: [520, 380], label: [520, 330], polys: [["M380 330l90-50 60 62-92 58z", .8], ["M520 390l108-20 28 88-104 28z", .9]] },
    "Coast": { pin: [700, 410], label: [700, 362], polys: [["M480 280l100-28 40 80-88 44z", .85], ["M590 480l80 8 12 80-76 12z", .75]] },
  };

  const S = { crop: D.crops.some(c => c.key === "tomato") ? "tomato" : D.crops[0].key, zone: "Inland farmland",
    iT: 0, iR: D.rain.indexOf(100), mode: "best", week: 0, zoom: 1, sheet: "half", list: false, lens: false };

  // ---------- small helpers ----------
  const $ = id => document.getElementById(id);
  const crop = k => D.crops.find(c => c.key === k);
  const zone = n => D.zones.find(z => z.name === n);
  const K = (c, z) => c + "|" + z;
  const si = (iT = S.iT, iR = S.iR) => iT * D.rain.length + iR;
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
  const day0 = new Date(D.daily.time[0] + "T00:00:00Z");
  const N = D.daily.temp.length;   // 365 days of 2025; the series repeats (model assumption)

  // ---------- which planting week is shown ----------
  function seasonWeek(c, z, season) {
    const arr = D.match[K(c, z)][si()], ms = SEASONS[season];
    const anyAllowed = D.weeks.some((_, w) => ms.includes(month(w)) && inMonths(c, w));
    let best = -1, bw = -1;
    D.weeks.forEach((_, w) => {
      if (!ms.includes(month(w)) || (anyAllowed && !inMonths(c, w))) return;
      if (arr[w] > best) { best = arr[w]; bw = w; }
    });
    return bw;
  }
  function weekFor(c, z) {
    if (S.mode === "best") return D.best[K(c, z)][si()];
    if (S.mode === "week") return S.week;
    return seasonWeek(c, z, S.mode);
  }

  // ---------- one model result (looked up, not computed) ----------
  function res(c, z, w) {
    const k = K(c, z), p = crop(c);
    return {
      w, match: sc(D.match[k][si()][w]), matchPct: D.match_pct[k][si()][w], temp: D.temp[k][S.iT][w], water: D.water[c][S.iR][w],
      salt: D.salt[k], rain: D.rain_mm[c][S.iR][w], irr: D.irrigation[c][S.iR][w], yld: D.yield[k][S.iT][w],
      warning: D.warning[k], needsSaline: D.needs_saline[k], inMonths: inMonths(c, w),
      plant: wDate(w), harvest: addDays(wDate(w), p.cycle_days),
      base: sc(D.match[k][si(0, D.rain.indexOf(100))][w]),
      cold: D.cold[k][S.iT][w], hot: D.hot[k][S.iT][w], saltDrop: D.salt_drop[k],
      usesSeawater: D.uses_seawater[k], penalty: D.penalty[c] || 1, zone: z,
    };
  }

  // Same sentence as scoring.explain() (checked against Python for every crop, zone and week)
  function explain(p, r) {
    const head = `${p.name} scores ${r.matchPct}% in ${r.zone}`;
    const scores = [["temperature", r.temp], ["water", r.water], ["soil salinity", r.salt]];
    const allGood = scores.every(s => s[1] >= D.good_score);
    if (allGood && r.penalty < 1) return `${head}. Main limit: soil pH, ${D.ph_reason}.`;
    if (allGood) {
      const water = r.irr >= 1 ? `about ${r.irr} mm of irrigation tops up the ${r.rain} mm of rain` : "rain covers its water need";
      const sea = r.usesSeawater ? " with seawater irrigation (assumed available)" : "";
      return `${head} and fits well: temperature, water and soil salinity are all in a good range${sea}; ${water}.`;
    }
    let weakest = scores[0];
    scores.forEach(s => { if (s[1] < weakest[1]) weakest = s; });
    let reason;
    if (weakest[0] === "temperature") {
      const cold = r.cold, hot = r.hot;
      reason = cold >= hot ? `too cold during ${cold}% of the growing season` : `too hot during ${hot}% of the growing season`;
      if (Math.min(cold, hot) >= 1) reason += cold >= hot ? ` and too hot during ${hot}%` : ` and too cold during ${cold}%`;
    } else if (weakest[0] === "water") {
      reason = `about ${r.irr} mm of irrigation needed because only ${r.rain} mm of rain falls in the growing season`;
    } else if (r.needsSaline) {
      reason = "it needs saline/seawater irrigation (~30 g/L), which this zone does not have";
    } else {
      reason = `yield drops by ${r.saltDrop}% at this soil salinity`;
    }
    return `${head}. Main limit: ${weakest[0]}, ${reason}.`;
  }

  // ---------- NASA SMAP daily data in the growing window (for display) ----------
  const zoneOffset = (z, m) => (D.summer_months.includes(m) ? zone(z).dT_summer : zone(z).dT_winter);
  function windowRange(c, w) {
    const d = wDate(w), doy = Math.round((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY) + 1;
    const a = Math.min(doy, 365) - 1;
    return [a, a + crop(c).cycle_days];
  }
  function dayInfo(i, z) {
    const m = addDays(day0, i).getUTCMonth() + 1;
    return { t: D.daily.temp[i % N] + zoneOffset(z, m) + D.dT[S.iT], p: D.daily.precip[i % N] * D.rain[S.iR] / 100, sm: D.daily.sm_rootzone[i % N] };
  }
  function windowStats(c, z, w) {
    const [a, b] = windowRange(c, w);
    let t = 0, sm = 0;
    for (let i = a; i < b; i++) { const d = dayInfo(i, z); t += d.t; sm += d.sm; }
    return { meanT: t / (b - a), sm: sm / (b - a) };
  }

  // ---------- SVG pieces ----------
  function ring(px, frac, color, text, vb = 44, r = 18, sw = 5, fs = 11) {
    const c = 2 * Math.PI * r, d = Math.max(0, Math.min(1, frac)) * c, h = vb / 2;
    return `<svg width="${px}" height="${px}" viewBox="0 0 ${vb} ${vb}" role="img" aria-label="${esc(text)}">` +
      `<circle cx="${h}" cy="${h}" r="${r}" fill="none" stroke="${C.track}" stroke-width="${sw}"/>` +
      (d > 0.5 ? `<circle cx="${h}" cy="${h}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${d.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${h} ${h})"/>` : "") +
      `<text x="${h}" y="${h}" dy=".36em" text-anchor="middle" font-family="Inter,sans-serif" font-weight="700" font-size="${fs}" fill="#2b3a2f">${esc(text)}</text></svg>`;
  }

  function rainBars() {   // design: "Monthly rainfall" (NASA SMAP L4 precipitation, 2025)
    const sums = new Array(12).fill(0);
    for (let i = 0; i < N; i++) sums[addDays(day0, i).getUTCMonth()] += D.daily.precip[i] * D.rain[S.iR] / 100;
    const max = Math.max(...sums, 1), names = "JFMAMJJASOND";
    let s = `<svg class="chart" viewBox="0 0 412 78" role="img" aria-label="Monthly rainfall 2025">`;
    sums.forEach((v, m) => {
      const h = Math.max(2, v / max * 54), x = 8 + m * 34;
      const label = MON[m];
      s += `<rect x="${x}" y="${60 - h}" width="22" height="${h}" rx="5" fill="${C.sea}"><title>${label}: ${v.toFixed(0)} mm</title></rect>` +
        `<text x="${x + 11}" y="74" text-anchor="middle" font-size="9" font-family="Inter,sans-serif" fill="#77827a">${names[m]}</text>`;
    });
    return s + "</svg>";
  }

  function weeksChart(c, z, wSel) {   // match % for every planting week (tap = choose that date)
    const arr = D.match[K(c, z)][si()], n = arr.length, W = 412, bw = W / n;
    let s = `<svg class="chart" viewBox="0 -4 ${W} 126" role="img" aria-label="Match by planting week">`;
    [50, 100].forEach(g => { const y = 100 - g; s += `<line x1="0" x2="${W}" y1="${y}" y2="${y}" stroke="rgba(43,58,51,.12)"/><text x="${W}" y="${y - 2}" text-anchor="end" font-size="8.5" font-family="Inter,sans-serif" fill="#77827a">${g}%</text>`; });
    arr.forEach((v, w) => {
      const h = Math.max(1.5, sc(v) * 100), fill = w === wSel ? C.teal : inMonths(c, w) ? C.olive : C.sand;
      s += `<rect class="wk" data-act="week" data-w="${w}" x="${(w * bw + 0.8).toFixed(1)}" y="${(100 - h).toFixed(1)}" width="${(bw - 1.6).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="${fill}"><title>${fmt(wDate(w))}: ${D.match_pct[K(c, z)][si()][w]}%${inMonths(c, w) ? "" : " (outside planting months)"}</title></rect>`;
    });
    let lastM = 0;
    arr.forEach((_, w) => { const m = month(w); if (m !== lastM && m % 2 === 1) s += `<text x="${(w * bw).toFixed(1)}" y="116" font-size="9" font-family="Inter,sans-serif" fill="#77827a">${fmt(wDate(w)).slice(3)}</text>`; lastM = m; });
    return s + "</svg>";
  }

  function climateChart(c, z, w) {   // temperature + rain in the window (+/- 30 days), not the whole repeated year
    const p = crop(c), [a, b] = windowRange(c, w), lo = Math.max(0, a - 30), hi = Math.min(2 * N - 1, b + 30);
    const days = []; for (let i = lo; i <= hi; i++) days.push(dayInfo(i, z));
    const tMin = Math.min(...days.map(d => d.t), p.t_min) - 1, tMax = Math.max(...days.map(d => d.t), p.t_max) + 1;
    const pMax = Math.max(...days.map(d => d.p), 5), W = 412;
    const x = i => ((i - lo) / (hi - lo)) * W, y = t => 8 + (1 - (t - tMin) / (tMax - tMin)) * 92;
    let s = `<svg class="chart" viewBox="0 0 ${W} 176" role="img" aria-label="Daily temperature and rain in the growing window">`;
    s += `<rect x="${x(a)}" y="0" width="${x(b) - x(a)}" height="160" fill="${C.teal}" opacity=".13"/>`;
    s += `<rect x="0" y="${y(p.t_max)}" width="${W}" height="${y(p.t_min) - y(p.t_max)}" fill="${C.olive}" opacity=".16"/>`;
    s += `<text x="4" y="${y(p.t_max) + 11}" font-size="9" font-family="Inter,sans-serif" fill="#566a22">optimum ${p.t_min}–${p.t_max} °C</text>`;
    s += `<polyline fill="none" stroke="${C.amber}" stroke-width="1.6" stroke-linejoin="round" points="${days.map((d, k) => `${x(lo + k).toFixed(1)},${y(d.t).toFixed(1)}`).join(" ")}"/>`;
    days.forEach((d, k) => { if (d.p > 0.2) { const h = d.p / pMax * 40; s += `<rect x="${x(lo + k).toFixed(1)}" y="${(158 - h).toFixed(1)}" width="1.6" height="${h.toFixed(1)}" fill="${C.sea}"/>`; } });
    s += `<line x1="0" x2="${W}" y1="158" y2="158" stroke="rgba(43,58,51,.2)"/>`;
    for (let i = lo; i <= hi; i++) { const d = addDays(day0, i); if (d.getUTCDate() === 1) s += `<text x="${x(i).toFixed(1)}" y="171" font-size="8.5" font-family="Inter,sans-serif" fill="#77827a">${MON[d.getUTCMonth()]}</text>`; }
    s += `<text x="${W}" y="${y(tMax - 1) + 9}" text-anchor="end" font-size="8.5" font-family="Inter,sans-serif" fill="#77827a">${(tMax - 1).toFixed(0)} °C</text>`;
    s += `<text x="${W}" y="${y(tMin + 1) - 2}" text-anchor="end" font-size="8.5" font-family="Inter,sans-serif" fill="#77827a">${(tMin + 1).toFixed(0)} °C</text>`;
    return s + "</svg>";
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

  function sheetPx() { return innerHeight * { peek: 0.27, half: 0.5, full: 0.92 }[S.sheet]; }
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
    lb.textContent = shifted() ? `Field Shift · +${D.dT[S.iT]} °C · ${D.rain[S.iR]}%` : "Lenses · Field Shift";
    lb.classList.toggle("active", shifted());
    $("lens").hidden = !S.lens;
    $("sT").value = S.iT; $("sR").value = S.iR;
    $("vT").textContent = `+${D.dT[S.iT]} °C`; $("vR").textContent = `${D.rain[S.iR]}% of 2025`;
  }

  // ---------- result panel ----------
  function renderPanel() {
    const c = S.crop, z = S.zone, p = crop(c), w = weekFor(c, z), r = res(c, z, w), [col, lab] = level(r.matchPct);
    const ws = windowStats(c, z, w), zz = zone(z);
    const how = S.mode === "best" ? "best date" : S.mode === "week" ? "chosen week" : `best in ${S.mode}`;
    let h = `<div class="hdr">${ring(64, r.match, col, r.matchPct + "%", 56, 22, 6, 14)}<div><div class="title">${esc(p.name)} <span>(${esc(z)})</span></div><span class="lvl" style="background:${col}">${lab}</span></div></div>`;
    if (PH[c]) h += `<figure class="photo"><img src="${PH[c].src}" alt="${esc(p.name)}"><figcaption>${esc(PH[c].credit)}</figcaption></figure>`;
    h += `<p class="desc">${esc(explain(p, r))}</p>`;
    h += `<div class="tags"><span class="tag">${ws.meanT.toFixed(0)} °C Temp</span><span class="tag">${r.irr} mm · Irrigation</span><span class="tag">${fmt(r.plant)}–${fmt(r.harvest)}</span></div>`;
    h += `<div class="www"><b>Where:</b> ${esc(z)} · soil salinity ${zz.ece} dS/m (model estimate)${zz.saline_water_available ? ` · ${esc(D.saline_label)}` : ""}<br>` +
      `<b>When:</b> plant ${fmt(r.plant)} (${how}) → harvest/end ${fmt(r.harvest, true)}<br>` +
      `<b>How:</b> about ${r.irr} mm of irrigation on top of ${r.rain} mm of rain</div>`;
    h += `<div class="rings">` +
      `<div class="ring">${ring(72, r.water, C.olive, pct(r.water) + "%")}Water<small>score</small></div>` +
      `<div class="ring">${ring(72, r.salt, C.teal, pct(r.salt) + "%")}Salinity<small>ECe ${zz.ece} dS/m</small></div>` +
      `<div class="ring">${ring(72, ws.sm, C.sea, Math.round(ws.sm * 100) + "%")}Moisture<small>SMAP root zone</small></div>` +
      `<div class="ring">${ring(72, r.temp, C.olive2, ws.meanT.toFixed(0) + "°")}Temp<small>fit ${pct(r.temp)}%</small></div></div>`;
    h += `<div class="yield">Crop match <b>${r.matchPct}%</b> · Expected yield vs ideal <b>${r.yld.toFixed(0)}%</b>` +
      `<small>Yield index = salt tolerance × temperature fit (not tonnes). Crop match also counts water, so the two differ.</small></div>`;
    if (shifted()) h += `<div class="banner shift">Field Shift: +${D.dT[S.iT]} °C, rain ${D.rain[S.iR]}% of 2025 → ${(r.match - r.base) * 100 >= 0 ? "+" : ""}${Math.round((r.match - r.base) * 100)} points vs the 2025 climate.</div>`;
    if (r.warning) h += `<div class="banner">⚠ ${esc(r.warning)}</div>`;
    if (!r.inMonths) h += `<div class="banner info">This date is outside the crop's usual planting months.</div>`;
    h += `<div class="sec">Monthly rainfall <small>· NASA SMAP L4, 2025${shifted() ? ` × ${D.rain[S.iR]}%` : ""}</small></div>${rainBars()}`;
    const ranked = D.crops.map(cc => { const rr = res(cc.key, z, w); return { c: cc, m: rr.match, p: rr.matchPct }; }).sort((x, y) => y.m - x.m);
    h += `<div class="sec">All crops in ${esc(z)} <small>· planted ${fmt(r.plant)}</small></div><div class="rank">` +
      ranked.map(({ c: cc, m, p }) => `<button class="rk" data-act="crop" data-crop="${esc(cc.key)}"><span>${esc(cc.name)}</span><span class="bar"><i style="width:${Math.max(1, m * 100)}%;background:${cc.key === c ? C.teal : C.light}"></i></span><b>${p}%</b></button>`).join("") + `</div>`;
    h += `<div class="sec">Match by planting week <small>· tap a bar to choose a date</small></div>${weeksChart(c, z, w)}`;
    h += `<div class="sec">Temperature & rain in the growing window <small>· shaded = window</small></div>${climateChart(c, z, w)}`;
    h += `<p class="note">Zone values are model estimates (soil salinity ${zz.ece} dS/m, temperature offset ${zz.dT_summer >= 0 ? "+" : ""}${zz.dT_summer} °C May–Oct / ${zz.dT_winter >= 0 ? "+" : ""}${zz.dT_winter} °C Nov–Apr). ` +
      `Cycle ${p.cycle_days} days (approximate).${p.assumed ? ` Assumed values for this crop: ${esc(p.notes)}.` : ""} Dates after 31 Dec 2025 reuse the 2025 data.</p>`;
    h += `<div class="limits"><b>Limitations</b><ul>` +
      `<li>SMAP is 9 km: one grid cell covers all zones; differences between zones are model assumptions.</li>` +
      `<li>Soil salinity is not measurable by satellite; zone values are model estimates (Campo de Cartagena soils measured 2–10 dS/m).</li>` +
      `<li>Climate data is 2025 only (next year assumed equal). Crop cycle lengths are approximate.</li>` +
      `<li>The map is an illustration; zone shapes are not surveyed boundaries.</li>` +
      `<li>Data source: NASA SMAP L4 SPL4SMGP v008.</li></ul></div>`;
    h += `<div class="credits">Photos via Openverse: ` + Object.entries(PH).map(([k, v]) => `<a href="${esc(v.source)}" target="_blank" rel="noopener">${esc(crop(k) ? crop(k).name : k)}</a> (${esc(v.short)})`).join(", ") + `.</div>`;
    $("panelBody").innerHTML = h;
  }

  function render() { renderTop(); fitView(); $("map").innerHTML = mapSVG(); renderPanel(); }

  // ---------- events ----------
  document.addEventListener("click", e => {
    const el = e.target.closest("[data-act]");
    if (!el) { if (S.list) { S.list = false; renderTop(); } return; }
    const act = el.dataset.act;
    if (act === "list") { S.list = !S.list; S.lens = false; renderTop(); return; }
    if (act === "crop") { S.crop = el.dataset.crop; S.list = false; }
    else if (act === "zone") { S.zone = el.dataset.zone; S.list = false; }
    else if (act === "mode") { S.mode = el.dataset.mode; }
    else if (act === "week") { S.mode = "week"; S.week = +el.dataset.w; }
    else if (act === "zoom") { S.zoom = Math.min(S.zoom * 1.3, 2.6); }
    else if (act === "locate") { S.zoom = 1; }
    else if (act === "lens") { S.lens = !S.lens; S.list = false; }
    else if (act === "reset") { S.iT = 0; S.iR = D.rain.indexOf(100); }
    render();
  });
  document.addEventListener("keydown", e => {
    if ((e.key === "Enter" || e.key === " ") && e.target.classList && e.target.classList.contains("zone")) { e.preventDefault(); e.target.dispatchEvent(new MouseEvent("click", { bubbles: true })); }
    if (e.key === "Escape") { S.list = false; S.lens = false; renderTop(); }
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
