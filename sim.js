/* EV Range Magic — moteur de simulation (navigateur + Node pour les tests)
 * Modèle physique par segment (~400 m) : aéro (densité de l'air selon T, pression, humidité; vent de face/arrière et de travers),
 * roulement (pneus, froid, chaussée mouillée/enneigée), pente (régénération), chauffage/clim, gestion thermique batterie.
 * Calibré pour chaque véhicule sur sa cote RNCan autoroute, puis validé sur les résultats réels du Défi 500 km d'Alex.
 */
(function (root) {
  'use strict';
  const G = 9.81;

  // ---------- Hypothèses (toutes regroupées ici pour être faciles à ajuster) ----------
  const H = {
    RHO_EPA: 98210 / (287.058 * 293.15), // densité de référence des coefficients EPA (20 °C, 98,21 kPa)
    EPA_WEIGHT: 0.5,         // poids de la physique EPA vs le recalage RNCan (validé sur le Défi 500 km)
    V_REF_KMH: 108,          // la cote RNCan autoroute (× rendement de recharge) ≈ conso batterie à 105 km/h stables, 20 °C, sans vent (calé sur Défi 500 km)
    T_REF: 20,
    CHARGE_EFF: 0.90,        // prise -> batterie (RNCan mesure à la prise)
    DRIVETRAIN_EFF: 0.88,
    REGEN_EFF: 0.65,
    AUX_KW: 0.30,            // électronique, phares, etc.
    WIND_HEIGHT_FACTOR: 0.65,// vent à 10 m -> vent à hauteur d'auto (loi logarithmique, terrain ouvert)
    YAW_DRAG_K: 3.0,         // hausse du CdA avec l'angle de lacet (vent de travers) : CdA·(1 + k·β²)
    CRR_SUMMER: 0.0085,
    WINTER_TIRE_FACTOR: 1.15,
    CRR_COLD_PER_C: 0.003,   // +0,6 %/°C sous 20 °C (pneus plus rigides)
    WET_FACTOR: 1.15, SNOW_FACTOR: 1.45,
    DRIVETRAIN_COLD_PER_C: 0.0015, // huiles/réducteur plus visqueux au froid
    CABIN_UA_KW_PER_C: 0.085, // besoin de chaleur de l'habitacle à 110 km/h
    CABIN_SET_C: 21,
    CABIN_WARMUP_KWH_PER_C: 0.06,   // réchauffer l'habitacle au départ (par °C sous 21)
    BATT_WARM_KWH_PER_C: 0.06,      // réchauffer la batterie au départ (par °C sous 10 °C)
    PRECOND_KWH_PER_C: 0.06,        // préchauffage avant recharge rapide (par °C sous 15 °C)
    COLD_CAP_PER_C: 0.0025,         // capacité utilisable perdue par °C sous 10 °C
    STOP_OVERHEAD_MIN: 5,           // sortir, brancher, payer
    STOP_PREFERENCE_MIN: 3,
    PREFERRED_NETWORKS: /circuit [ée]lectrique|sprint|tesla|couche[- ]tard/i,
    NONPREF_PENALTY_MIN: 15,        // un autre réseau n'est choisi que s'il fait gagner plus de 15 min (dernier recours)         // un arrêt de plus doit faire gagner au moins 3 min pour être retenu
    MIN_STOP_SOC: 0.10,             // un arrêt ajoute au moins 10 points de % (pas de recharge « éclair » de 1 min)
    DETOUR_KMH: 50,
  };

  // Valeurs typiques par catégorie RNCan (masse avec conducteur + bagages, CdA m²)
  const CLASS_DEFAULTS = {
    'Two-seater': { mass: 1900, cda: 0.55 }, 'Minicompact': { mass: 1500, cda: 0.62 },
    'Subcompact': { mass: 1750, cda: 0.65 }, 'Compact': { mass: 1850, cda: 0.62 },
    'Mid-size': { mass: 2050, cda: 0.56 }, 'Full-size': { mass: 2350, cda: 0.62 },
    'Station wagon: Small': { mass: 2000, cda: 0.66 }, 'Station wagon: Mid-size': { mass: 2300, cda: 0.68 },
    'Sport utility vehicle: Small': { mass: 2250, cda: 0.80 }, 'Sport utility vehicle: Standard': { mass: 2750, cda: 0.98 },
    'Minivan': { mass: 2600, cda: 0.95 }, 'Pickup truck: Standard': { mass: 3400, cda: 1.30 },
  };

  // Courbe de recharge générique (fraction de la puissance de pointe selon l'état de charge)
  const CURVE = [[0, .70], [.05, .90], [.10, 1], [.35, 1], [.50, .85], [.60, .72], [.70, .58], [.80, .45], [.90, .25], [1, .06]];
  function curveFrac(soc) {
    for (let i = 1; i < CURVE.length; i++) if (soc <= CURVE[i][0]) {
      const [a, fa] = CURVE[i - 1], [b, fb] = CURVE[i]; return fa + (fb - fa) * (soc - a) / (b - a);
    } return CURVE[CURVE.length - 1][1];
  }

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const rad = d => d * Math.PI / 180;

  function airDensity(Tc, pHpa, rh) {
    const T = Tc + 273.15;
    const psat = 6.1078 * Math.pow(10, 7.5 * Tc / (Tc + 237.3)); // hPa
    const pv = (rh ?? 70) / 100 * psat, pd = pHpa - pv;
    return (pd * 100) / (287.058 * T) + (pv * 100) / (461.495 * T);
  }

  function heatPumpCOP(T) { return clamp(1.0 + 0.07 * (T + 25), 1.2, 3.0); }

  function hvacKw(veh, T) {
    if (T < 17) {
      const q = H.CABIN_UA_KW_PER_C * (H.CABIN_SET_C - T);
      return veh.heatPump ? q / heatPumpCOP(T) : q;
    }
    if (T > 24) return 0.15 * (T - 22);
    return 0.1;
  }

  function crr(veh, wx) {
    let c = H.CRR_SUMMER * (veh.winterTires ? H.WINTER_TIRE_FACTOR : 1);
    c *= 1 + H.CRR_COLD_PER_C * Math.max(0, H.T_REF - wx.T);
    if (wx.snow > 0.05 || (wx.precip > 0.2 && wx.T <= 0.5)) c *= H.SNOW_FACTOR;
    else if (wx.precip > 0.2) c *= H.WET_FACTOR;
    return c;
  }

  // Force de traction aux roues (N) + détails
  function wheelForces(veh, v, wx, headingDeg, grade) {
    const rho = airDensity(wx.T, wx.p, wx.rh);
    const w = (wx.ws || 0) / 3.6 * H.WIND_HEIGHT_FACTOR;
    // wd = direction d'OÙ vient le vent; composante de face = w·cos(wd − cap)
    const rel = rad((wx.wd || 0) - headingDeg);
    const head = w * Math.cos(rel), cross = w * Math.sin(rel);
    const ua = v + head;
    const beta = Math.min(0.35, Math.atan2(Math.abs(cross), Math.max(ua, 1)));
    const cosg = 1 / Math.sqrt(1 + grade * grade), sing = grade * cosg;
    const yaw = 1 + H.YAW_DRAG_K * beta * beta;
    let Faero, Froll;
    if (veh.rl) {
      // Coefficients EPA (essai de décélération libre, corrigés à 20 °C et 98,21 kPa) : F = A + B·v + C·v²
      // A + B·v = pertes mécaniques et pneus (suivent la vitesse au sol); C·v² = surtout l'aéro (suit la vitesse de l'air et la densité)
      const r = veh.rl, fr = crr(veh, wx) / H.CRR_SUMMER;
      Froll = (r.A + r.B * v) * fr * cosg;
      Faero = r.C * (rho / H.RHO_EPA) * yaw * ua * Math.abs(ua);
    } else {
      Faero = 0.5 * rho * veh.cda * yaw * ua * Math.abs(ua);
      Froll = veh.mass * G * crr(veh, wx) * cosg;
    }
    const Fgrade = veh.mass * G * sing;
    return { Faero, Froll, Fgrade, rho, head, cross };
  }

  function drivetrainEff(T) { return H.DRIVETRAIN_EFF / (1 + H.DRIVETRAIN_COLD_PER_C * Math.max(0, H.T_REF - T)); }

  // Énergie (kWh, côté batterie) pour un segment de dKm à vKmh
  function segmentEnergy(veh, dKm, vKmh, wx, heading, grade) {
    const v = vKmh / 3.6, d = dKm * 1000, t = d / v;
    const f = wheelForces(veh, v, wx, heading, grade);
    const eff = drivetrainEff(wx.T);
    const Ftot = f.Faero + f.Froll + f.Fgrade;
    const k = veh.k;
    let traction;
    if (Ftot >= 0) traction = Ftot * d / eff * k; else traction = Ftot * d * H.REGEN_EFF * k;
    // répartition (pour le graphique « où va l'énergie ») : chaque force × distance / rendement; la pente peut être négative (descente)
    const J2kWh = 1 / 3.6e6;
    const hvac = hvacKw(veh, wx.T) * t / 3600, aux = H.AUX_KW * t / 3600;
    const per = Ftot >= 0 ? d / eff * k * J2kWh : 0;
    const aero = f.Faero * per, roll = f.Froll * per;
    const climb = Ftot >= 0 ? f.Fgrade * per : traction * J2kWh; // négatif = régénération nette
    return { kWh: traction * J2kWh + hvac + aux, aero, roll, climb, hvac, aux, t, rho: f.rho, head: f.head * 3.6, cross: f.cross * 3.6 };
  }

  // ---------- Véhicule ----------
  function vehicleFromRncan(row, o = {}) {
    const cls = CLASS_DEFAULTS[row.cls] || CLASS_DEFAULTS['Sport utility vehicle: Small'];
    const batteryEst = row.range * row.comb / 100 * H.CHARGE_EFF;
    const LBF = 4.44822, MPH = 2.23694;
    const rl = row.rl && o.useEpa !== false ? { A: row.rl.A * LBF, B: row.rl.B * LBF * MPH, C: row.rl.C * LBF * MPH * MPH, src: row.rl.epa } : null;
    const veh = {
      name: `${row.year} ${row.make} ${row.model}`, row, rl,
      mass: o.mass || (rl ? Math.round(row.rl.etw * 0.453592) : cls.mass), cda: o.cda || (rl ? +(2 * rl.C / 1.204).toFixed(3) : cls.cda),
      batteryKwh: o.batteryKwh || Math.round(batteryEst * 10) / 10, batteryEst,
      dcPeakKw: o.dcPeakKw || 150, heatPump: o.heatPump ?? (row.year >= 2021), v800: o.v800 ?? is800V(row),
      winterTires: !!o.winterTires,
    };
    calibrate(veh);
    return veh;
  }

  function calibrate(veh) {
    if (veh.rl && H.PURE_EPA) { veh.k = 1; return veh; }   // test : physique EPA seule, sans recalage RNCan
    const hb = veh.row.hwy * H.CHARGE_EFF;                       // kWh/100 km côté batterie
    const ref = { T: H.T_REF, p: 1013.25, rh: 50, ws: 0, wd: 0, precip: 0, snow: 0 };
    const summer = Object.assign({}, veh, { k: 1, winterTires: false });
    const e = segmentEnergy(summer, 100, H.V_REF_KMH, ref, 0, 0);
    const nonTraction = e.hvac + e.aux;
    veh.kRncan = Math.max(0.5, (hb - nonTraction) / (e.kWh - nonTraction));
    // avec les coefficients EPA, on mélange la physique EPA (k = 1) et le recalage RNCan (moyenne géométrique pondérée)
    veh.k = veh.rl ? Math.pow(veh.kRncan, 1 - H.EPA_WEIGHT) : veh.kRncan;
    return veh;
  }

  // ---------- Recharge ----------
  // Architecture 800 V (liste à jour en 2026-2027; modifiable dans l'app)
  const V800 = [['Hyundai', /IONIQ (5|6|9)/i], ['Kia', /EV6|EV9/i], ['Genesis', /GV60|GV70|G80|Electrified/i], ['Porsche', /Taycan|Macan/i],
    ['Audi', /e-tron GT|Q6|SQ6|A6 e-tron|S6 e-tron|RS e-tron/i], ['Lucid', /./], ['Lotus', /./], ['Chevrolet', /Silverado/i],
    ['GMC', /Sierra|Hummer/i], ['Cadillac', /Escalade IQ|ESCALADE IQ/i], ['Tesla', /Cybertruck/i], ['BMW', /iX3 50/i],
    ['Mercedes-Benz', /CLA .*Electric/i]];
  function isPreferred(c) { return H.PREFERRED_NETWORKS.test((c.operator || '') + ' ' + (c.name || '')); }
  function is800V(row) { return V800.some(([mk, re]) => row.make.toLowerCase() === mk.toLowerCase() && re.test(row.model)); }

  // Puissance que la borne peut réellement fournir à ce véhicule
  function chargerKw(veh, c) {
    const tesla = /tesla/i.test(c.operator || '') || /supercharger/i.test(c.name || '');
    if (veh.v800) {
      if (tesla) return Math.min(c.kw, 130);          // Superchargeur (≈ 500 V max) : passe par le survolteur du véhicule
      if (c.kw <= 62.5) return c.kw * 0.85;           // vieilles 50 kW plafonnées en courant : moins efficaces en 800 V
      return c.kw;
    }
    if (c.kw400) return c.kw400;                      // valeur publiée par le réseau (ex. Sprint : 140 kW en 400 V)
    if (!tesla && c.kw > 200) return 200;             // bornes ~500 A : environ 200 kW au plus en 400 V
    return c.kw;
  }

  function chargeMinutes(veh, charger, socFrom, socTo, T, precond) {
    if (socTo <= socFrom) return 0;
    let cold = 1;
    if (precond) cold = T < -20 ? 0.85 : 1;
    else cold = clamp(0.35 + 0.65 * (T + 15) / 30, 0.35, 1);
    const cap = veh.capUsable;
    let min = 0;
    const step = 0.005;
    for (let s = socFrom; s < socTo - 1e-9; s += step) {
      const ds = Math.min(step, socTo - s);
      const kw = Math.min(veh.dcPeakKw * curveFrac(s + ds / 2), chargerKw(veh, charger)) * cold * 0.97;
      min += ds * cap / Math.max(kw, 1) * 60;
    }
    return min;
  }

  // ---------- Itinéraire ----------
  function heading(a, b) {
    const p1 = rad(a.lat), p2 = rad(b.lat), dl = rad(b.lon - a.lon);
    const x = Math.sin(dl) * Math.cos(p2), y = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
  }

  function prepareSegments(route) {
    const P = route.points, segs = [];
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], b = P[i], d = b.km - a.km;
      if (d <= 0) continue;
      segs.push({ km0: a.km, km1: b.km, d, v: b.v, leg: b.leg, lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2,
        heading: heading(a, b), grade: clamp((b.ele - a.ele) / (d * 1000), -0.08, 0.08) });
    }
    return segs;
  }

  // ---------- Simulation complète ----------
  // opts : { departISO (ms), socStart, reserveCharger, reserveEnd, socMax, minChargerKw, teslaAccess, precond, speedHwy, wxAt(lat, lon, tMs) }
  function simulate(veh, route, opts) {
    const segs = prepareSegments(route);
    const Tavg0 = opts.wxAt(route.points[0].lat, route.points[0].lon, opts.departMs).T;
    // bornes utilisables; à une même sortie (± 1,5 km), on garde la meilleure de chaque catégorie (accélère le calcul)
    const groups = new Map();
    for (const c of route.chargers) {
      if (!(c.kw >= opts.minChargerKw && (!c.tesla_only || opts.teslaAccess))) continue;
      const key = `${c.leg}|${Math.round(c.km / 1.5)}|${isPreferred(c)}`;
      const g = groups.get(key), kw = chargerKw({ v800: veh.v800 }, c);
      if (!g || kw > g.kwEff + 1 || (Math.abs(kw - g.kwEff) <= 1 && (c.detour_km || 0) < (g.c.detour_km || 0))) groups.set(key, { c, kwEff: kw });
    }
    const chargers = [...groups.values()].map(g => g.c).sort((a, b) => a.km - b.km);
    let stopsDelay = []; // [{km, minutes}] (itération précédente)
    let result = null;
    for (let iter = 0; iter < 3; iter++) {
      // 1) énergie par segment, à l'heure de passage
      let tMs = opts.departMs, cum = 0;
      const cumE = [0], seg = [];
      const tot = { aero: 0, roll: 0, climb: 0, hvac: 0, aux: 0, batt: 0, precond: 0 };
      let Tsum = 0, Tmin = 99, Tmax = -99, driveH = 0;
      for (const s of segs) {
        for (const sd of stopsDelay) if (sd.km > s.km0 - 1e-6 && sd.km <= s.km1 + 1e-6 && !sd.applied) { tMs += sd.minutes * 60000; sd.applied = true; }
        const wx = opts.wxAt(s.lat, s.lon, tMs);
        const v = s.v >= 110 ? opts.speedHwy : s.v;
        const e = segmentEnergy(veh, s.d, v, wx, s.heading, s.grade);
        cum += e.kWh; cumE.push(cum);
        for (const k of ['aero', 'roll', 'climb', 'hvac', 'aux']) tot[k] += e[k];
        Tsum += wx.T * s.d; Tmin = Math.min(Tmin, wx.T); Tmax = Math.max(Tmax, wx.T);
        driveH += s.d / v;
        seg.push({ ...s, vUsed: v, kWh: e.kWh, wx, head: e.head, cross: e.cross, tMs });
        tMs += s.d / v * 3600000;
      }
      stopsDelay.forEach(sd => sd.applied = false);
      const totalKm = segs[segs.length - 1].km1;
      const Tavg = Tsum / totalKm;
      // énergies ponctuelles liées au froid
      const warm = H.CABIN_WARMUP_KWH_PER_C * Math.max(0, H.CABIN_SET_C - Tavg0) * (veh.heatPump ? 0.6 : 1)
                 + H.BATT_WARM_KWH_PER_C * Math.max(0, 10 - Tavg0);
      tot.batt = warm;
      veh.capUsable = veh.batteryKwh * (1 - H.COLD_CAP_PER_C * Math.max(0, 10 - Tavg));
      const E = km => { // énergie cumulée à km (interpolation)
        let lo = 0, hi = segs.length - 1;
        while (lo < hi) { const m = (lo + hi) >> 1; if (segs[m].km1 < km) lo = m + 1; else hi = m; }
        const s = segs[lo], f = clamp((km - s.km0) / s.d, 0, 1);
        return cumE[lo] + f * (cumE[lo + 1] - cumE[lo]) + warm * Math.min(1, km / 60);
      };
      const tempAt = km => { const s = seg.find(x => x.km1 >= km) || seg[seg.length - 1]; return s.wx.T; };

      // 2) planification des recharges : programmation dynamique (temps d'arrêt minimal)
      const cap = veh.capUsable;
      const nodes = [{ km: 0, start: true }, ...chargers.map(c => ({ ...c })), { km: totalKm, end: true }];
      const N = nodes.length, RES = 100; // pas de 1 %
      const precondKwh = T => opts.precond ? H.PRECOND_KWH_PER_C * Math.max(0, 15 - T) : 0;
      const detourKwh = n => n.detour_km ? n.detour_km * 0.2 : 0;
      // temps de recharge cumulé 0 -> s pour chaque borne (minutes)
      const cumT = nodes.map(n => {
        if (n.start || n.end) return null;
        const arr = new Float64Array(RES + 1), T = tempAt(n.km);
        for (let s = 1; s <= RES; s++) arr[s] = arr[s - 1] + chargeMinutes(veh, n, (s - 1) / RES, s / RES, T, opts.precond);
        return arr;
      });
      const stopFixed = n => H.STOP_OVERHEAD_MIN + (n.detour_km || 0) / H.DETOUR_KMH * 60;
      const best = Array.from({ length: N }, () => new Float64Array(RES + 1).fill(Infinity));
      const prev = Array.from({ length: N }, () => new Array(RES + 1).fill(null));
      best[0][Math.round(opts.socStart * RES)] = 0;
      const maxIdx = Math.round(opts.socMax * RES);
      const Ekm = nodes.map(n => E(n.km));
      const edgeExtra = nodes.map(n => n.end ? 0 : detourKwh(n) + precondKwh(tempAt(n.km)));
      for (let i = 0; i < N - 1; i++) {
        const ni = nodes[i];
        for (let a = 0; a <= RES; a++) {
          const t0 = best[i][a]; if (!isFinite(t0)) continue;
          const lo = ni.start ? a : a + Math.round(H.MIN_STOP_SOC * RES), hi = ni.start ? a : Math.max(a, maxIdx);
          for (let dep = lo; dep <= hi; dep++) {
            const tc = ni.start ? 0 : cumT[i][dep] - cumT[i][a] + stopFixed(ni);
            const eDep = dep / RES * cap;
            for (let j = i + 1; j < N; j++) {
              const nj = nodes[j];
              const arrKwh = eDep - (Ekm[j] - Ekm[i]) - edgeExtra[j];
              const reserve = (nj.end ? opts.reserveEnd : opts.reserveCharger) * cap;
              if (arrKwh < reserve - 1e-9) { if (arrKwh < reserve - 3) break; continue; }   // bornes triées par km : au-delà, encore moins d'énergie
              const arr = Math.min(RES, Math.floor(arrKwh / cap * RES + 1e-9));
              const t = t0 + tc + (ni.start ? 0 : H.STOP_PREFERENCE_MIN + (opts.preferNetworks && !isPreferred(ni) ? H.NONPREF_PENALTY_MIN : 0));   // préférence (optimisation seulement) pour moins d'arrêts
              if (t < best[j][arr] - 1e-9) { best[j][arr] = t; prev[j][arr] = { i, a, dep, tc }; }
            }
          }
        }
      }
      // meilleure arrivée : temps minimal, puis le plus d'énergie restante
      let bestA = -1, bestT = Infinity;
      for (let a = 0; a <= RES; a++) if (best[N - 1][a] < bestT - 0.01 || (Math.abs(best[N - 1][a] - bestT) <= 0.01 && a > bestA)) { if (isFinite(best[N - 1][a])) { bestT = best[N - 1][a]; bestA = a; } }
      const feasible = bestA >= 0;
      const stops = [];
      let finalSoc = null;
      if (feasible) {
        finalSoc = bestA / RES;
        let j = N - 1, a = bestA;
        while (j > 0) {
          const p = prev[j][a]; if (!p) break;
          if (!nodes[p.i].start) stops.unshift({ node: nodes[p.i], arrSoc: p.a / RES, depSoc: p.dep / RES, minutes: p.tc,
            chargeMin: p.tc - stopFixed(nodes[p.i]),
            kWh: (p.dep - p.a) / RES * cap, T: tempAt(nodes[p.i].km), km: nodes[p.i].km });
          j = p.i; a = p.a;
        }
      }
      const precondTotal = stops.reduce((s, x) => s + precondKwh(x.T), 0);
      tot.precond = precondTotal;
      const usedKwh = E(totalKm) + precondTotal + stops.reduce((s, x) => s + detourKwh(x.node), 0);
      const hwySegs = seg.filter(s => s.v >= 110);
      const hwyKm = hwySegs.reduce((s, x) => s + x.d, 0), hwyKwh = hwySegs.reduce((s, x) => s + x.kWh, 0);
      const legStats = [0, 1].map(l => {
        const ss = seg.filter(s => s.leg === l), km = ss.reduce((a, s) => a + s.d, 0), kwh = ss.reduce((a, s) => a + s.kWh, 0);
        const head = ss.reduce((a, s) => a + s.head * s.d, 0) / km;
        const T = ss.reduce((a, s) => a + s.wx.T * s.d, 0) / km;
        return { km, kwh, per100: kwh / km * 100, head, T, hours: ss.reduce((a, s) => a + s.d / s.vUsed, 0) };
      });
      const per100Trip = usedKwh / totalKm * 100;
      const hwyPer100 = hwyKwh / hwyKm * 100;
      const stopMin = stops.reduce((s, x) => s + x.minutes, 0);
      result = {
        feasible, stops, finalSoc, totalKm, usedKwh, per100Trip, hwyPer100, legStats, breakdown: tot, warmKwh: warm,
        capUsable: cap, Tavg, Tmin, Tmax, driveH, stopMin, totalH: driveH + stopMin / 60,
        rangeHwy: cap / (hwyPer100 + warm / totalKm * 100) * 100,      // 100 → 0 %
        rangeHwy100to10: cap * 0.9 / (hwyPer100 + warm / totalKm * 100) * 100,
        rangeRncan: veh.row.range, seg, departMs: opts.departMs, arrivalMs: opts.departMs + (driveH * 60 + stopMin) * 60000,
        socTrace: buildTrace(seg, stops, cap, opts.socStart, E),
      };
      const newDelay = stops.map(s => ({ km: s.km, minutes: s.minutes }));
      if (JSON.stringify(newDelay.map(x => [x.km, Math.round(x.minutes)])) === JSON.stringify(stopsDelay.map(x => [x.km, Math.round(x.minutes)]))) break;
      stopsDelay = newDelay;
    }
    return result;
  }

  function buildTrace(seg, stops, cap, soc0, E) {
    const pts = [{ km: 0, soc: soc0 }];
    let base = soc0 * cap, offset = 0, si = 0;
    for (const s of seg) {
      while (si < stops.length && stops[si].km <= s.km1 + 1e-6 && stops[si].km >= s.km0 - 1e-6) {
        const st = stops[si];
        pts.push({ km: st.km, soc: st.arrSoc });
        pts.push({ km: st.km, soc: st.depSoc, stop: true });
        offset = E(st.km); base = st.depSoc * cap; si++;
      }
      pts.push({ km: s.km1, soc: (base - (E(s.km1) - offset)) / cap });
    }
    return pts;
  }

  const api = { isPreferred, is800V, chargerKw, H, CLASS_DEFAULTS, CURVE, curveFrac, airDensity, segmentEnergy, vehicleFromRncan, calibrate, chargeMinutes, simulate, prepareSegments, hvacKw };
  if (typeof module !== 'undefined') module.exports = api; else root.EVSim = api;
})(typeof window !== 'undefined' ? window : globalThis);
