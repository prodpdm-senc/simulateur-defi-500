/* EV Range Magic — interface */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const ROUTE = window.ROUTE, S = window.EVSim;

  // ---------- Cartes réorganisables : poignée à glisser (ordinateur), flèches ▲▼ (tactile), ordre mémorisé dans le navigateur ----------
  const Order = (() => {
    const KEY = 'evrm-ordre-cartes-v1', FKEY = 'evrm-cartes-repliees-v1';
    const FOLD_DEFAULT = new Set(['sources', 'hyp', 'nostop']);   // repliées au premier affichage
    if (matchMedia('(max-width: 640px)').matches) ['energie', 'wx'].forEach(k => FOLD_DEFAULT.add(k));   // téléphone : les longs tableaux aussi
    let folds = {}; try { folds = JSON.parse(localStorage.getItem(FKEY) || '{}') || {}; } catch (e) { folds = {}; }
    const isFolded = k => k in folds ? folds[k] : FOLD_DEFAULT.has(k);
    function setFold(blk, v, save) {
      blk.classList.toggle('collapsed', v);
      blk.querySelectorAll('h2').forEach(h => h.setAttribute('aria-expanded', String(!v)));
      if (save) { folds[blk.dataset.k] = v; try { localStorage.setItem(FKEY, JSON.stringify(folds)); } catch (e) {} moved(); }
      if (save && !v && blk.dataset.k === 'carte' && map && mapBounds) setTimeout(() => { map.invalidateSize(); map.fitBounds(mapBounds, { padding: [20, 20] }); }, 0);
    }
    document.addEventListener('click', e => {
      const h = e.target.closest('.blk h2'); if (!h || e.target.closest('a,button,input,select')) return;
      const blk = h.closest('.blk'); setFold(blk, !blk.classList.contains('collapsed'), true);
    });
    document.addEventListener('keydown', e => {
      const h = e.target.closest && e.target.closest('.blk h2'); if (!h || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault(); const blk = h.closest('.blk'); setFold(blk, !blk.classList.contains('collapsed'), true);
    });
    // les titres ajoutés plus tard (10 prochains jours, trajet sans arrêt) deviennent aussi des boutons
    new MutationObserver(() => document.querySelectorAll('.blk h2:not([tabindex])').forEach(h => { h.tabIndex = 0; h.setAttribute('role', 'button'); h.setAttribute('aria-expanded', String(!h.closest('.blk').classList.contains('collapsed'))); }))
      .observe(document.body, { childList: true, subtree: true });
    let saved = {}; const defaults = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { saved = {}; }
    const zoneOf = el => el.closest('[data-zone]');
    const blocks = zone => [...zone.children].filter(c => c.classList.contains('blk'));
    function persist(zone) {
      saved[zone.dataset.zone] = blocks(zone).map(b => b.dataset.k);
      try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) { /* stockage indisponible : l'ordre vaut pour cette visite */ }
      syncReset();
    }
    function syncReset() { const b = $('resetOrder'); if (b) b.hidden = !Object.keys(saved).length; }
    function moved() { window.dispatchEvent(new Event('resize')); }   // carte Leaflet et graphique se recalent
    function controls(blk) {
      if (blk.querySelector(':scope > .mv')) return;
      const d = document.createElement('div'); d.className = 'mv';
      d.innerHTML = '<button type="button" class="up" title="Monter" aria-label="Monter la carte">▲</button><button type="button" class="dn" title="Descendre" aria-label="Descendre la carte">▼</button><span class="grip" title="Glisser pour déplacer" aria-hidden="true">⠿</span>';
      d.querySelector('.up').onclick = () => step(blk, -1);
      d.querySelector('.dn').onclick = () => step(blk, 1);
      d.querySelector('.grip').addEventListener('pointerdown', () => { blk.draggable = true; });
      blk.prepend(d);
      blk.addEventListener('dragstart', e => { if (!blk.draggable) return; blk.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', blk.dataset.k); } catch (_) {} });
      blk.addEventListener('dragend', () => { blk.draggable = false; blk.classList.remove('dragging'); persist(zoneOf(blk)); moved(); });
    }
    function step(blk, dir) {
      const list = blocks(zoneOf(blk)).filter(b => b.offsetParent !== null && b.matches(':has(> .card, > .kpis, > .grid2, > h2)'));
      const i = list.indexOf(blk), j = i + dir; if (j < 0 || j >= list.length) return;
      if (dir < 0) list[j].before(blk); else list[j].after(blk);
      persist(zoneOf(blk)); moved();
      blk.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      blk.querySelector(dir < 0 ? '.up' : '.dn').focus();
    }
    function enableDrop(zone) {
      if (zone._drop) return; zone._drop = true;
      zone.addEventListener('dragover', e => {
        const drag = zone.querySelector(':scope > .blk.dragging'); if (!drag) return;
        e.preventDefault();
        const after = blocks(zone).filter(b => b !== drag).find(b => { const r = b.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
        if (after) { if (drag.nextElementSibling !== after) after.before(drag); } else if (blocks(zone).at(-1) !== drag) blocks(zone).at(-1).after(drag);
      });
      zone.addEventListener('drop', e => e.preventDefault());
    }
    function apply(zone) {
      const want = saved[zone.dataset.zone] || [];
      const bl = blocks(zone), byK = Object.fromEntries(bl.map(b => [b.dataset.k, b]));
      defaults[zone.dataset.zone] = bl.map(b => b.dataset.k);
      // les cartes connues reprennent l'ordre mémorisé ; une nouvelle carte garde sa place par défaut à la suite
      const first = bl[0] ? bl[0].previousElementSibling : null;
      let anchor = first;
      want.filter(k => byK[k]).forEach(k => { const b = byK[k]; if (anchor) anchor.after(b); else zone.prepend(b); anchor = b; });
      bl.forEach(controls); bl.forEach(b => setFold(b, isFolded(b.dataset.k), false)); enableDrop(zone);
    }
    function reset() {
      saved = {}; try { localStorage.removeItem(KEY); } catch (e) {}
      document.querySelectorAll('[data-zone]').forEach(zone => {
        const byK = Object.fromEntries(blocks(zone).map(b => [b.dataset.k, b]));
        (defaults[zone.dataset.zone] || []).forEach(k => byK[k] && zone.appendChild(byK[k]));
      });
      syncReset(); moved();
    }
    function applyFolds(root) { root.querySelectorAll('.blk').forEach(b => setFold(b, isFolded(b.dataset.k), false)); }
    return { apply, reset, syncReset, applyFolds };
  })();
  let RN = window.RNCAN.rows, rnFile = window.RNCAN.file;
  let selected = null, wxMode = 'auto', map = null, mapLayers = null, mapBounds = null;

  // Puissance de recharge DC observée lors des essais Défi 500 km de PDM (sinon estimation à vérifier)
  const DC_REF = [
    ['Tesla', /Model 3.*(Long Range|LR|Premium AWD|Performance)/i, 250, 'Défi 500 km PDM'], ['Tesla', /Model 3/i, 170, 'Défi 500 km PDM'],
    ['Tesla', /Model Y/i, 235, 'Défi 500 km PDM'], ['Hyundai', /IONIQ 5/i, 255, 'Défi 500 km PDM', 2025], ['Hyundai', /IONIQ 5/i, 150, 'Défi 500 km PDM'],
    ['Hyundai', /IONIQ 6/i, 180, 'Défi 500 km PDM'], ['Hyundai', /IONIQ 9/i, 230, 'Défi 500 km PDM'], ['Hyundai', /Kona/i, 92, 'Défi 500 km PDM'],
    ['Kia', /EV4/i, 120, 'Défi 500 km PDM'], ['Kia', /EV5/i, 151, 'Défi 500 km PDM'], ['Kia', /EV6/i, 260, 'Défi 500 km PDM'], ['Kia', /EV9/i, 205, 'Défi 500 km PDM'],
    ['Kia', /Niro/i, 77, 'Défi 500 km PDM'], ['Volkswagen', /ID\.?\s?4/i, 135, 'Défi 500 km PDM'], ['Chevrolet', /Equinox/i, 104, 'Défi 500 km PDM'],
    ['Chevrolet', /Blazer/i, 155, 'Défi 500 km PDM'], ['Chevrolet', /Bolt/i, 150, 'Défi 500 km PDM', 2027], ['Chevrolet', /Bolt/i, 52, 'Défi 500 km PDM'],
    ['Ford', /Mach-E/i, 138, 'Défi 500 km PDM'], ['Ford', /Lightning/i, 175, 'Défi 500 km PDM'], ['Polestar', /^2/i, 143, 'Défi 500 km PDM'],
    ['Polestar', /^3/i, 192, 'Défi 500 km PDM'], ['Polestar', /^4/i, 200, 'Défi 500 km PDM'], ['Cadillac', /LYRIQ/i, 182, 'Défi 500 km PDM'],
    ['Cadillac', /OPTIQ/i, 147, 'Défi 500 km PDM'], ['Cadillac', /VISTIQ/i, 180, 'Défi 500 km PDM'], ['Honda', /Prologue/i, 155, 'Défi 500 km PDM'],
    ['MINI', /Countryman/i, 113, 'Défi 500 km PDM'], ['BMW', /i4/i, 205, 'Défi 500 km PDM'], ['Nissan', /LEAF/i, 150, 'Défi 500 km PDM', 2026],
    ['Nissan', /ARIYA/i, 100, 'Défi 500 km PDM'], ['Volvo', /C40|EC40/i, 145, 'Défi 500 km PDM'], ['Volvo', /EX30/i, 155, 'Défi 500 km PDM'],
    ['Mercedes-Benz', /EQE/i, 120, 'Défi 500 km PDM'], ['Toyota', /bZ/i, 150, 'Défi 500 km PDM', 2026], ['Toyota', /bZ4X/i, 80, 'Défi 500 km PDM'],
    ['Mazda', /MX-30/i, 55, 'Défi 250 km PDM'],
  ];
  function dcLookup(row) {
    for (const [mk, re, kw, src, minYear] of DC_REF)
      if (row.make.toLowerCase() === mk.toLowerCase() && re.test(row.model) && (!minYear || row.year >= minYear)) return { kw, src };
    return { kw: 150, src: 'estimation (à vérifier)' };
  }

  // ---------- Véhicules RNCan ----------
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9.]+/g, ' ').trim();
  const label = r => `${r.year} ${r.make} ${r.model}`;
  // Choix du véhicule en 3 menus : année → marque → version RNCan
  let chosen = null, autoRange = true;
  const byLabel = (a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base', numeric: true });
  function opts(sel, list, ph) {
    sel.innerHTML = `<option value="">${ph}</option>` + list.map(([v, t]) => `<option value="${esc(String(v))}">${esc(t)}</option>`).join('');
    sel.disabled = !list.length;
  }
  function fillYears() {
    const ys = [...new Set(RN.map(r => r.year))].sort((a, b) => b - a);
    opts($('selYear'), ys.map(y => [y, y]), 'Année…');
  }
  function fillMakes(keep) {
    const y = +$('selYear').value;
    const ms = y ? [...new Set(RN.filter(r => r.year === y).map(r => r.make))].sort(byLabel) : [];
    opts($('selMake'), ms.map(m => [m, m]), y ? 'Marque…' : '—');
    if (keep && ms.includes(keep)) $('selMake').value = keep;
  }
  function fillVersions(keepModel) {
    const y = +$('selYear').value, mk = $('selMake').value;
    const rows = y && mk ? RN.map((r, i) => [r, i]).filter(([r]) => r.year === y && r.make === mk).sort((a, b) => byLabel(a[0].model, b[0].model) || a[0].range - b[0].range) : [];
    opts($('selModel'), rows.map(([r, i]) => [i, `${r.model} · ${r.range} km`]), mk ? `Modèle (${rows.length})…` : '—');
    if (keepModel) { const hit = rows.find(([r]) => r.model === keepModel); if (hit) $('selModel').value = hit[1]; }
    return $('selModel').value;
  }
  function choose(row) {
    chosen = row || null;
    $('model').value = row ? label(row) : '';
    if (row && (autoRange || !$('rangeIn').value)) { $('rangeIn').value = row.range; autoRange = true; }
    if (!row && autoRange) $('rangeIn').value = '';
    syncClear(); validate();
  }
  function setRow(row) {
    $('selYear').value = row.year; fillMakes(row.make); fillVersions();
    $('selModel').value = RN.indexOf(row); choose(row);
  }
  function syncClear() { $('clearModel').hidden = !$('model').value; }
  function fillModels() {
    fillYears(); fillMakes(); fillVersions();
    $('rnsrc').textContent = `${rnFile} (${RN.length} VÉ, ${Math.min(...RN.map(r => r.year))}-${Math.max(...RN.map(r => r.year))})`;
  }
  function matchModel(q) {
    const nq = norm(q); if (!nq) return [];
    const exact = RN.filter(r => norm(label(r)) === nq); if (exact.length) return exact.map(r => ({ r, score: 1 }));
    const qt = nq.split(' ');
    const yearQ = qt.find(t => /^20\d\d$/.test(t));
    return RN.map(r => {
      const lt = norm(label(r)).split(' ');
      let hit = 0; for (const t of qt) if (lt.includes(t)) hit++; else if (lt.some(x => x.startsWith(t) && t.length >= 2)) hit += 0.6;
      let score = hit / qt.length - 0.02 * Math.max(0, lt.length - qt.length);
      if (yearQ && String(r.year) !== yearQ) score -= 0.5;
      return { r, score };
    }).filter(x => x.score > 0.45).sort((a, b) => b.score - a.score).slice(0, 6);
  }

  function validate() {
    const q = $('model').value, rIn = parseFloat($('rangeIn').value), box = $('valid');
    const m = matchModel(q);
    if (!q.trim()) { box.innerHTML = ''; selected = null; return; }
    if (!m.length) { box.innerHTML = `<div class="valid bad"><b>✗ Introuvable dans le CSV RNCan.</b> Vérifie l'année et le nom du modèle (choisis dans la liste).</div>`; selected = null; return; }
    let pick = chosen && label(chosen) === q ? chosen : m[0].r;
    // si l'autonomie entrée correspond à une autre variante proche, la proposer
    const sameRange = isFinite(rIn) ? m.filter(x => Math.abs(x.r.range - rIn) <= 1 && x.score >= m[0].score - 0.15) : [];
    if (!chosen && sameRange.length && Math.abs(pick.range - rIn) > 1) pick = sameRange[0].r;
    const rl = pick.rl;
    const rlTxt = rl ? `<br>Road Load ${esc(rl.epa)}${rl.q < 0.7 ? ' (correspondance approximative : vérifie la variante)' : ''} : A ${rl.A} lbf · B ${rl.B} lbf/mph · C ${rl.C} lbf/mph² · ${Math.round(rl.etw * 0.453592)} kg d'essai`
      : `<br>Pas de coefficients Road Load EPA pour ce modèle : valeurs typiques de la catégorie.`;
    const srcTxt = pick.src === 'outil' ? ' · source : outil de recherche RNCan (CSV 2027 pas encore publié)' : '';
    const specs = `<div class="specs">${pick.cls} · ${pick.kw} kW · ville ${pick.city} / autoroute ${pick.hwy} / combinée ${pick.comb} kWh/100 km · autonomie ${pick.range} km${srcTxt}${rlTxt}</div>`;
    const others = m.filter(x => x.r !== pick).slice(0, 3).map(x => `<a href="#" data-i="${RN.indexOf(x.r)}">${label(x.r)} (${x.r.range} km)</a>`).join('<br>');
    const alt = others ? `<details style="margin-top:6px"><summary>Autres variantes</summary>${others}</details>` : '';
    let html;
    if (!isFinite(rIn)) html = `<div class="valid warn"><b>${label(pick)}</b> trouvé. Entre l'autonomie RNCan pour valider (RNCan : ${pick.range} km). <button class="small" id="useR">Utiliser ${pick.range} km</button>${specs}${alt}</div>`;
    else if (Math.abs(pick.range - rIn) <= 1) html = `<div class="valid ok"><b>✓ Validé RNCan</b> : ${label(pick)}, ${pick.range} km.${specs}${alt}</div>`;
    else html = `<div class="valid bad"><b>✗ Ne concorde pas.</b> RNCan indique <b>${pick.range} km</b> pour ${label(pick)} (tu as entré ${rIn} km). <button class="small" id="useR">Corriger à ${pick.range} km</button>${specs}${alt}</div>`;
    box.innerHTML = html;
    const ub = $('useR'); if (ub) ub.onclick = () => { $('rangeIn').value = pick.range; validate(); };
    box.querySelectorAll('a[data-i]').forEach(a => a.onclick = e => { e.preventDefault(); autoRange = true; setRow(RN[+a.dataset.i]); });
    if (selected !== pick) {
      selected = pick;
      const cls = S.CLASS_DEFAULTS[pick.cls] || S.CLASS_DEFAULTS['Sport utility vehicle: Small'];
      $('bat').value = (pick.range * pick.comb / 100 * S.H.CHARGE_EFF).toFixed(1);
      const dc = dcLookup(pick); $('dc').value = dc.kw;
      $('dcsrc').textContent = `Batterie estimée d'après RNCan (autonomie × conso combinée × 90 %). Puissance DC : ${dc.src}. Ajuste au besoin.`;
      $('hp').checked = pick.year >= 2021; $('v800').checked = S.is800V(pick);
      $('mass').value = rl ? Math.round(rl.etw * 0.453592) : cls.mass;
      $('cda').value = rl ? (2 * rl.C * 4.44822 * 2.23694 ** 2 / 1.204).toFixed(2) : cls.cda;
      $('cda').disabled = !!rl;
      $('cdahint').textContent = rl ? 'Aéro et pertes de roulement tirées des coefficients A/B/C de l\'EPA (CdA équivalent affiché à titre indicatif). La masse sert aux pentes.'
        : 'Valeurs typiques de la catégorie RNCan. Le modèle est recalé sur la cote autoroute RNCan, donc un CdA approximatif change surtout la sensibilité au vent et à la vitesse.';
      $('tesla').checked = /tesla/i.test(pick.make);
    }
  }

  // ---------- Météo ----------
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const STATIONS = (() => {
    const p0 = ROUTE.points.filter(p => p.leg === 0), L = p0[p0.length - 1].km, out = [];
    for (let i = 0; i < 10; i++) { const km = L * i / 9; out.push(p0.reduce((b, p) => Math.abs(p.km - km) < Math.abs(b.km - km) ? p : b)); }
    return out;
  })();
  const PLACES = [[45.443, -73.623, 'LaSalle'], [45.50, -73.46, 'Brossard'], [45.60, -73.32, 'Saint-Bruno'], [45.63, -72.96, 'Saint-Hyacinthe'],
    [45.87, -72.49, 'Drummondville'], [46.03, -72.19, 'Saint-Eugène'], [46.16, -71.97, 'Daveluyville'], [46.30, -71.70, 'Villeroy'],
    [46.53, -71.62, 'Laurier-Station'], [46.60, -71.50, 'Saint-Apollinaire'], [46.72, -71.28, 'Lévis (sortie 314)']];
  const placeName = (lat, lon) => PLACES.reduce((b, p) => { const d = (p[0] - lat) ** 2 + ((p[1] - lon) * 0.7) ** 2; return d < b.d ? { d, n: p[2] } : b; }, { d: 1e9 }).n;

  // ---------- Prévisions des 10 prochains jours (automatique) ----------
  let outlookW = null, outlookAt = 0, outlookRun = 0;
  async function outlookWeather() {
    if (window.EVRM_ARTIFACT) return snapshotWeatherRaw();
    if (outlookW && Date.now() - outlookAt < 3600e3) return outlookW;
    const q = new URLSearchParams({
      latitude: STATIONS.map(s => s.lat).join(','), longitude: STATIONS.map(s => s.lon).join(','),
      hourly: 'temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_direction_10m,precipitation,snowfall',
      forecast_days: 12, timeformat: 'unixtime', timezone: 'GMT', wind_speed_unit: 'kmh' });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`), js = await res.json();
    if (!res.ok || js.error) throw new Error('Prévisions indisponibles : ' + (js.reason || res.status));
    const arr = Array.isArray(js) ? js : [js];
    outlookW = { source: 'Open-Meteo (prévisions)', st: arr.map((a, i) => ({ ...STATIONS[i], h: a.hourly })) }; outlookAt = Date.now();
    return outlookW;
  }
  function snapshotWeatherRaw() {
    const S0 = window.WX_SNAPSHOT; if (!S0) throw new Error('Aucun instantané météo.');
    return { source: `Open-Meteo, instantané du ${S0.fetched}`, st: S0.st };
  }
  async function renderOutlook(veh, opts) {
    const box = $('outlook'); if (!box) return;
    const token = ++outlookRun;
    box.className = 'card'; box.innerHTML = '<h2>Les 10 prochains jours</h2><p class="note">Calcul des prévisions…</p>';
    let W;
    try { W = await outlookWeather(); } catch (e) { box.innerHTML = `<h2>Les 10 prochains jours</h2><p class="note">${esc(e.message)}</p>`; return; }
    const T = W.st[0].h.time, tEnd = T[T.length - 1] * 1000;
    const [hh, mm] = ($('time').value || '09:00').split(':').map(Number);
    const rows = [];
    const day0 = new Date(); day0.setHours(hh, mm, 0, 0);
    for (let d = 0; d <= 10 && rows.length < 10; d++) {
      const dep = new Date(day0); dep.setDate(day0.getDate() + d);
      const ms = dep.getTime();
      if (ms < Date.now() - 600e3 || ms < T[0] * 1000) continue;
      if (ms + 9 * 3600e3 > tEnd) break;
      await new Promise(r => setTimeout(r, 0));
      if (token !== outlookRun) return;                  // une nouvelle simulation a été lancée
      const pr = box.querySelector('.note'); if (pr) pr.textContent = `Calcul des prévisions… jour ${rows.length + 1} sur 10`;
      const r = S.simulate(veh, ROUTE, { ...opts, departMs: ms, wxAt: makeWxAt(W) });
      const mid = r.seg[Math.floor(r.seg.length / 4)].wx;
      rows.push({ ms, r, mid });
    }
    if (!rows.length) { box.innerHTML = '<h2>Les 10 prochains jours</h2><p class="note">Aucune prévision disponible pour les prochains jours.</p>'; return; }
    const ok = rows.filter(x => x.r.feasible);
    const best = ok.length ? ok.reduce((a, b) => b.r.totalH < a.r.totalH - 1 / 60 || (Math.abs(b.r.totalH - a.r.totalH) <= 1 / 60 && b.r.per100Trip < a.r.per100Trip) ? b : a) : null;
    const tMin = Math.min(...ok.map(x => x.r.totalH)), tMax = Math.max(...ok.map(x => x.r.totalH));
    const dayFmt = ms => new Date(ms).toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short' });
    const bar = h => { const w = tMax > tMin ? 25 + 75 * (h - tMin) / (tMax - tMin) : 60; return `<div style="height:8px;border-radius:4px;background:var(--c-aero);opacity:.55;width:${w}%"></div>`; };
    box.innerHTML = `<h2>Les 10 prochains jours · départ à ${pad(hh)} h ${pad(mm)}</h2>
      <div class="tw"><table><thead><tr><th>Jour</th><th>Temp.</th><th>Vent</th><th>Conso</th><th>Autonomie ${opts.speedHwy} km/h</th><th>Recharges</th><th>Temps total</th><th style="width:18%"></th><th></th></tr></thead><tbody>
      ${rows.map(x => { const r = x.r, isBest = best && x === best, chMin = r.stops.reduce((a, s) => a + s.chargeMin, 0);
        return `<tr${isBest ? ' style="background:var(--ok-bg)"' : ''}><td><b>${dayFmt(x.ms)}</b>${isBest ? ' <span class="pill" style="background:var(--ok);color:var(--panel)">meilleur</span>' : ''}</td>
        <td>${f0(r.Tmin)} à ${f0(r.Tmax)} °C</td>
        <td><span class="arrow" style="transform:rotate(${(x.mid.wd + 180) % 360}deg)">↑</span> ${f0(x.mid.ws)} km/h ${compass(x.mid.wd)}</td>
        <td>${f1(r.per100Trip)} kWh/100 km</td><td>${f0(r.rangeHwy)} km</td>
        <td>${r.feasible ? `${r.stops.length} · ${f0(chMin)} min` : '—'}</td>
        <td>${r.feasible ? hm(r.totalH * 60) : 'impossible'}</td><td>${r.feasible ? bar(r.totalH) : ''}</td>
        <td><button class="small" data-day="${x.ms}">Choisir</button></td></tr>`; }).join('')}
      </tbody></table></div>
      <p class="note">Calcul automatique avec tes réglages actuels et les prévisions ${esc(W.source)}, pour chaque jour à la même heure de départ. Vent : à 10 m, vers Drummondville, au passage à l'aller. Les prévisions au-delà de 5 à 7 jours restent indicatives.</p>`;
    box.querySelectorAll('button[data-day]').forEach(b => b.onclick = () => {
      $('date').value = ymd(new Date(+b.dataset.day)); $('date').dispatchEvent(new Event('change')); run(); window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  async function fetchWeather(departMs) {
    if (window.EVRM_ARTIFACT) return snapshotWeather(departMs);
    const d0 = new Date(departMs), d1 = new Date(departMs + 36 * 3600e3);
    const now = Date.now(), daysAhead = (departMs - now) / 86400e3;
    if (daysAhead > 15.5) throw new Error('Open-Meteo ne prévoit que 16 jours à l\'avance. Choisis une date plus proche ou passe en météo manuelle.');
    const archive = daysAhead < -85;
    const base = archive ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
    const q = new URLSearchParams({
      latitude: STATIONS.map(s => s.lat).join(','), longitude: STATIONS.map(s => s.lon).join(','),
      hourly: 'temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_direction_10m,precipitation,snowfall',
      start_date: ymd(new Date(departMs - 3600e3)), end_date: ymd(d1), timeformat: 'unixtime', timezone: 'GMT', wind_speed_unit: 'kmh',
    });
    const res = await fetch(`${base}?${q}`);
    const js = await res.json();
    if (!res.ok || js.error) throw new Error('Météo indisponible : ' + (js.reason || res.status));
    const arr = Array.isArray(js) ? js : [js];
    return { source: archive ? 'Open-Meteo (archives ERA5)' : 'Open-Meteo (prévisions/analyses)', st: arr.map((a, i) => ({ ...STATIONS[i], h: a.hourly })) };
  }
  function snapshotWeather(departMs) {
    const S0 = window.WX_SNAPSHOT;
    if (!S0) throw new Error('Aucun instantané météo dans cette version. Passe en météo manuelle.');
    const T = S0.st[0].h.time, t0 = T[0] * 1000, t1 = T[T.length - 1] * 1000;
    const fmt = ms => new Date(ms).toLocaleDateString('fr-CA', { day: 'numeric', month: 'long' });
    if (departMs < t0 || departMs + 8 * 3600e3 > t1)
      throw new Error(`L'instantané météo couvre du ${fmt(t0)} au ${fmt(t1 - 8 * 3600e3)} (pris le ${S0.fetched}). Choisis une date dans cette période ou passe en météo manuelle.`);
    return { source: `Open-Meteo, instantané du ${S0.fetched}`, st: S0.st };
  }
  function makeWxAt(W) {
    if (W.manual) return () => W.manual;
    return (lat, lon, tMs) => {
      let st = W.st[0], bd = 1e9;
      for (const s of W.st) { const d = (s.lat - lat) ** 2 + ((s.lon - lon) * 0.7) ** 2; if (d < bd) { bd = d; st = s; } }
      const h = st.h, t = tMs / 1000, T = h.time;
      let i = T.findIndex(x => x > t); if (i <= 0) i = i === 0 ? 1 : T.length - 1;
      const f = Math.max(0, Math.min(1, (t - T[i - 1]) / (T[i] - T[i - 1])));
      const L = k => { const a = h[k][i - 1], b = h[k][i]; return a == null ? b : b == null ? a : a + (b - a) * f; };
      // direction : interpolation vectorielle
      const ws = L('wind_speed_10m');
      const u = k => Math.sin(h.wind_direction_10m[k] * Math.PI / 180) * h.wind_speed_10m[k], v = k => Math.cos(h.wind_direction_10m[k] * Math.PI / 180) * h.wind_speed_10m[k];
      const uu = u(i - 1) + (u(i) - u(i - 1)) * f, vv = v(i - 1) + (v(i) - v(i - 1)) * f;
      return { T: L('temperature_2m'), rh: L('relative_humidity_2m'), p: L('surface_pressure'), ws, wd: (Math.atan2(uu, vv) * 180 / Math.PI + 360) % 360,
        precip: L('precipitation'), snow: L('snowfall') };
    };
  }

  // ---------- Simulation ----------
  async function run() {
    $('runerr').innerHTML = '';
    validate();
    if (!selected) { $('runerr').innerHTML = '<div class="err">Choisis d\'abord un véhicule présent dans le CSV RNCan.</div>'; return; }
    const departMs = new Date(`${$('date').value}T${$('time').value || '09:00'}`).getTime();
    if (!isFinite(departMs)) { $('runerr').innerHTML = '<div class="err">Date ou heure invalide.</div>'; return; }
    const btn = $('run'); btn.disabled = true; btn.textContent = 'Simulation…';
    try {
      let W;
      if (wxMode === 'manual') {
        const pr = $('mPr').value, T = +$('mT').value;
        W = { manual: { T, p: +$('mP').value, rh: +$('mRh').value, ws: +$('mWs').value, wd: +$('mWd').value,
          precip: pr === 'dry' ? 0 : 1, snow: pr === 'snow' ? 0.5 : 0 }, source: 'Météo manuelle' };
      } else W = await fetchWeather(departMs);
      const veh = S.vehicleFromRncan(selected, { batteryKwh: +$('bat').value, dcPeakKw: +$('dc').value, heatPump: $('hp').checked, v800: $('v800').checked,
        winterTires: $('winter').checked, mass: +$('mass').value, cda: +$('cda').value });
      const opts = { departMs, socStart: +$('soc0').value / 100, socMax: +$('socmax').value / 100, reserveCharger: +$('resC').value / 100,
        reserveEnd: +$('resE').value / 100, minChargerKw: +$('minkw').value, teslaAccess: $('tesla').checked, preferNetworks: $('prefnet').checked, precond: $('precond').checked,
        speedHwy: +$('speed').value || 110, wxAt: makeWxAt(W) };
      const r = S.simulate(veh, ROUTE, opts);
      render(veh, r, opts, W);
      if (!r.feasible || r.stops.length) setTimeout(() => renderNoStop(veh, opts, W), 30);
      if (wxMode === 'auto') setTimeout(() => renderOutlook(veh, opts), 60);
    } catch (e) {
      console.error(e); $('runerr').innerHTML = `<div class="err">${e.message}</div>`;
    } finally { btn.disabled = false; btn.textContent = '▶ Simuler le trajet'; }
  }

  // ---------- Rendu ----------
  const f1 = x => x.toLocaleString('fr-CA', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const f0 = x => Math.round(x).toLocaleString('fr-CA');
  const hm = min => `${Math.floor(min / 60)} h ${pad(Math.round(min % 60))}`;
  const hmShort = min => `${Math.floor(min / 60)}h${pad(Math.round(min % 60))}`;
  const clock = ms => { const d = new Date(ms); return `${pad(d.getHours())} h ${pad(d.getMinutes())}`; };
  const compass = deg => ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(deg / 45) % 8];
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function render(veh, r, opts, W) {
    const out = $('out');
    const turnKm = ROUTE.points.find(p => p.leg === 1).km;
    const dRange = (r.rangeHwy - r.rangeRncan) / r.rangeRncan * 100;
    const chMin = r.stops.reduce((a, s) => a + s.chargeMin, 0);
    const avgV = r.totalKm / r.driveH, avgVall = r.totalKm / r.totalH;
    const tires = veh.winterTires ? 'Hiver' : 'Été';
    const Ttxt = Math.round(r.Tmin) === Math.round(r.Tmax) ? `${Math.round(r.Tavg)}` : `${Math.round(r.Tmin)} à ${Math.round(r.Tmax)}`;
    const defiCells = [veh.name, tires, f1(veh.batteryKwh), Math.round(veh.dcPeakKw), r.stops.length, hmShort(chMin), Math.round(avgV), Math.round(avgVall), f1(r.per100Trip), hmShort(r.totalH * 60), Ttxt, 'A20 MTL-QC (simulé)'];
    const B = r.breakdown, parts = [
      ['Aérodynamisme', B.aero, 'var(--c-aero)'], ['Roulement', B.roll, 'var(--c-roll)'], ['Pentes (net)', B.climb, 'var(--c-climb)'],
      ['Chauffage / clim', B.hvac, 'var(--c-hvac)'], ['Accessoires', B.aux, 'var(--c-aux)'], ['Batterie froide + préchauffage', B.batt + B.precond, 'var(--c-batt)']];
    const ptot = parts.reduce((a, p) => a + Math.max(0, p[1]), 0);

    const ms = $('msum'); if (ms) ms.textContent = r.feasible ? `${f0(r.rangeHwy)} km · ${hm(r.totalH * 60)} · ${r.stops.length} arrêt${r.stops.length > 1 ? 's' : ''}` : 'trajet impossible';
    out.innerHTML = `
      ${r.feasible ? '' : `<div class="card err"><b>Trajet impossible avec ces réglages.</b> Aucune combinaison de bornes ne permet de boucler le trajet en gardant les réserves demandées. Essaie d'abaisser la puissance minimale des bornes, d'activer les Superchargeurs ou de réduire les réserves.</div>`}
      <div class="blk" data-k="kpis"><h2 class="kh">Résumé</h2><div class="kpis">
        <div class="kpi hero"><div class="lbl">Autonomie à ${opts.speedHwy} km/h (100 → 0 %)</div><div class="val">${f0(r.rangeHwy)}<small>km</small></div>
          <div class="foot">RNCan ${f0(r.rangeRncan)} km · <span class="delta ${dRange < 0 ? 'neg' : 'pos'}">${dRange >= 0 ? '+' : ''}${f0(dRange)} %</span> · 100 → 10 % : ${f0(r.rangeHwy100to10)} km</div></div>
        <div class="kpi"><div class="lbl">Temps total du trajet</div><div class="val">${r.feasible ? hm(r.totalH * 60) : '—'}</div>
          <div class="foot">Départ ${clock(r.departMs)} · retour ${clock(r.arrivalMs)} · ${f0(r.totalKm)} km</div></div>
        <div class="kpi"><div class="lbl">Arrêts de recharge</div><div class="val">${r.feasible ? r.stops.length : '—'}<small>${r.stops.length > 1 ? 'arrêts' : 'arrêt'}</small></div>
          <div class="foot">${f0(chMin)} min branché · ${f0(r.stopMin)} min d'arrêt au total</div></div>
        <div class="kpi"><div class="lbl">Consommation moyenne</div><div class="val">${f1(r.per100Trip)}<small>kWh/100 km</small></div>
          <div class="foot">${f1(r.usedKwh)} kWh · arrivée à ${r.finalSoc != null ? f0(r.finalSoc * 100) : '—'} %</div></div>
      </div></div>

      <div class="blk" data-k="outlook"><div id="outlook"></div></div>
      <div class="blk" data-k="legs"><div class="card"><h2>Aller et retour</h2>
        <div class="legsplit">${r.legStats.map((l, i) => `<div class="leg"><div class="t">${i ? 'Retour : Lévis → LaSalle' : 'Aller : LaSalle → Lévis'}</div>
          <div class="n">${f1(l.per100)} <span class="note">kWh/100 km</span></div>
          <div class="note">${f0(l.km)} km · ${f1(l.T)} °C en moyenne · vent ${l.head >= 0 ? 'de face' : 'arrière'} ${f0(Math.abs(l.head))} km/h (moyenne, à hauteur d'auto)</div></div>`).join('')}</div>
      </div></div>

      <div class="blk" data-k="soc"><div class="card"><h2>État de charge le long du trajet</h2><div id="socchart"></div>
        <div class="legend"><span><i style="background:var(--soc)"></i>État de charge</span><span><i style="background:var(--muted);opacity:.25"></i>Altitude</span><span><i style="background:var(--brand)"></i>Recharge</span><span><i style="background:var(--muted)"></i>Bornes utilisables</span></div></div></div>
      <div class="blk" data-k="nostop"><div id="nostop"></div></div>

      <div class="blk" data-k="stops"><div class="card"><h2>Arrêts de recharge</h2>
        ${r.stops.length ? `<div class="tw"><table><thead><tr><th>#</th><th>Borne</th><th>km</th><th>Heure</th><th>Puissance</th><th>Arrivée</th><th>Départ</th><th>Énergie</th><th>Branché</th><th>Temp.</th></tr></thead><tbody>
        ${r.stops.map((s, i) => { const sg = r.seg.find(x => x.km1 >= s.km) || r.seg[r.seg.length - 1]; return `<tr><td>${i + 1}</td><td><b>${esc(s.node.name)}</b><br><span class="note">${S.isPreferred(s.node) ? '' : '<span class="pill">hors réseaux prioritaires</span> '}${esc(s.node.operator || '')}${s.node.tesla_only ? ' · Superchargeur' : ''}${s.node.note ? '<br>' + esc(s.node.note) : ''}${s.node.detour_km ? ` · détour ${f1(s.node.detour_km)} km` : ''}</span></td>
          <td>${f0(s.km)}</td><td>${clock(sg.tMs)}</td><td>${f0(Math.min(S.chargerKw(veh, s.node), veh.dcPeakKw))} kW${s.node.kw_known ? '' : ' <span class="pill">supposé</span>'}${S.chargerKw(veh, s.node) < s.node.kw ? `<br><span class="note">borne ${f0(s.node.kw)} kW, limitée en ${veh.v800 ? '800' : '400'} V</span>` : ''}</td><td>${f0(s.arrSoc * 100)} %</td><td>${f0(s.depSoc * 100)} %</td><td>${f1(s.kWh)} kWh</td><td>${f0(s.chargeMin)} min</td><td>${f0(s.T)} °C</td></tr>`; }).join('')}
        </tbody></table></div><p class="note">Arrêts choisis pour minimiser le temps total (recharge + ${S.H.STOP_OVERHEAD_MIN} min de manœuvre par arrêt + détour). La simulation recharge juste assez pour finir avec ${f0(opts.reserveEnd * 100)} % de réserve.</p>`
        : `<p>${r.feasible ? `Aucune recharge nécessaire : arrivée à ${f0(r.finalSoc * 100)} %.` : 'Aucun plan de recharge possible.'}</p>`}
      </div></div>

      <div class="blk" data-k="energie"><div class="grid2">
        <div class="card"><h2>Où va l'énergie</h2>
          <div class="bar">${parts.filter(p => p[1] > 0.05).map(p => `<div title="${p[0]}" style="width:${Math.max(0, p[1]) / ptot * 100}%;background:${p[2]}"></div>`).join('')}</div>
          <table style="margin-top:10px"><tbody>${parts.map(p => `<tr><td><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${p[2]};margin-right:6px"></i>${p[0]}</td><td style="text-align:right">${f1(p[1])} kWh</td><td style="text-align:right;color:var(--muted)">${f0(p[1] / ptot * 100)} %</td></tr>`).join('')}</tbody></table>
          <p class="note">Densité de l'air moyenne ${avgRho(r).toFixed(3).replace(".", ",")} kg/m³ · batterie utilisable ${f1(r.capUsable)} kWh à ${f1(r.Tavg)} °C (${f1(veh.batteryKwh)} kWh à 10 °C et plus)</p>
        </div>
        <div class="card"><h2>Ligne pour le tableau Défi 500 km</h2>
          <div class="tw"><table><tbody>${['Véhicule', 'Saison pneus', 'Capacité (kWh)', 'Pmax (kW)', '# recharges', 'Temps recharge', 'Vitesse moy.', 'Vmoy. + recharge', 'Conso (kWh/100 km)', 'Temps total', 'Temp. ext', 'Route'].map((h, i) => `<tr><td class="note">${h}</td><td><b>${esc(defiCells[i])}</b></td></tr>`).join('')}</tbody></table></div>
          <button class="small" id="copyDefi" style="margin-top:10px">Copier pour Excel</button>
        </div>
      </div></div>

      <div class="blk" data-k="wx"><div class="card"><h2>Météo à l'heure de passage · ${esc(W.source)}</h2>
        <div class="tw"><table><thead><tr><th>Lieu</th><th>Sens</th><th>Heure</th><th>Temp.</th><th>Vent</th><th>Effet</th><th>Pression</th><th>Humidité</th><th>Précip.</th></tr></thead><tbody>${wxRows(r)}</tbody></table></div>
        <p class="note">Vent mesuré à 10 m, ramené à environ 65 % à hauteur d'auto. « De face » = vitesse d'air ajoutée (+) ou retranchée (−) à la vitesse de l'auto.</p>
      </div></div>

      <div class="blk" data-k="carte"><div class="card"><h2>Carte</h2><div id="map"></div></div></div>

      <div class="blk" data-k="hyp"><div class="card"><h2>Hypothèses du modèle</h2>
        <ul class="ul">
          ${veh.rl ? `<li>Résistance à l'avancement : coefficients Road Load de l'EPA (${esc(veh.rl.src)}), F = A + B·v + C·v². A et B (pneus, mécanique) suivent la vitesse au sol, le froid et la chaussée ; C·v² (aéro) suit la vitesse de l'air et sa densité, ramenée de la référence EPA (20 °C, 98,21 kPa).</li>` : `<li>Pas de coefficients EPA pour ce modèle : masse et CdA typiques de la catégorie RNCan.</li>`}
          <li>Calibrage : la cote RNCan autoroute (${veh.row.hwy} kWh/100 km à la prise × 90 % de rendement de recharge) correspond à la conso batterie à ${S.H.V_REF_KMH} km/h stables, à 20 °C et sans vent. ${veh.rl ? `Avec les coefficients EPA, le facteur appliqué (${f1(veh.k * 100)} %) est la moyenne entre la physique EPA pure (100 %) et ce recalage RNCan (${f1(veh.kRncan * 100)} %).` : `Facteur de calibrage : ${f1(veh.k * 100)} %.`}</li>
          <li>Physique par tronçon de 400 m : aéro (densité de l'air selon température, pression et humidité ; vent de face, arrière et de travers), roulement (pneus d'hiver +15 %, froid, chaussée mouillée +15 %, enneigée +45 %), pentes (régénération à 65 %), chauffage (${veh.heatPump ? 'thermopompe' : 'résistif'}), climatisation et accessoires.</li>
          <li>Froid : réchauffage de l'habitacle et de la batterie au départ, préchauffage avant chaque recharge rapide, capacité utilisable réduite sous 10 °C.</li>
          <li>Recharge : courbe générique (pleine puissance de 10 à 35 %, puis décroissante), limitée par la borne. Puissance des bornes selon la base RNCan/AFDC, sinon OpenStreetMap (50 kW si inconnue). Véhicule ${veh.v800 ? '800 V : Superchargeurs plafonnés à environ 130 kW, vieilles bornes 50 kW à 85 %' : '400 V : bornes de plus de 200 kW plafonnées à environ 200 kW (Recharge Sprint : 140 kW)'}. Puissance partagée et files d'attente non simulées.</li>
          <li>Vitesses : ${opts.speedHwy} km/h sur l'A-30 et l'A-20, 105 km/h sur l'A-10, 90 km/h sur l'A-15 et le pont Samuel-De Champlain, vitesse OSRM en ville. Sans trafic.</li>
          <li>Validation sur 23 essais réels du Défi 500 km, dont l'EV5 et le Bolt 2027 (température seulement, sans vent) : conso +0,4 % en moyenne, écart absolu moyen 5,2 % (6,4 % sans les coefficients EPA), temps total +10 min en moyenne.</li>
        </ul>
      </div></div>`;
    Order.apply(out);

    $('copyDefi').onclick = () => {
      const txt = defiCells.join('\t');
      const fallback = () => { const ta = document.createElement('textarea'); ta.value = txt; ta.readOnly = true; ta.rows = 2; ta.style.width = '100%'; ta.style.marginTop = '8px';
        $('copyDefi').replaceWith(ta); ta.focus(); ta.select(); };
      try { navigator.clipboard.writeText(txt).then(() => { $('copyDefi').textContent = 'Copié ✓'; }, fallback); } catch (e) { fallback(); }
    };
    drawChart(r, opts, turnKm);
    drawMap(r, opts);
  }

  // ---------- Trajet sans arrêt : quels réglages permettent de boucler l'aller-retour sans recharger ----------
  function arrivalSoc(veh, o) {
    const r = S.simulate(veh, ROUTE, { ...o, minChargerKw: 1e9 });   // aucune borne utilisable
    const tr = r.socTrace; return { soc: tr[tr.length - 1].soc, r };
  }
  function emptyTxt(b) {
    const tr = b.r.socTrace, z = tr.find(p => p.soc <= 0);
    return z ? `À la vitesse choisie, sans recharge, la batterie serait vide vers le km ${f0(z.km)} sur ${f0(b.r.totalKm)}.`
             : `À la vitesse choisie, sans recharge, tu arriverais à ${f0(b.soc * 100)} %.`;
  }
  function renderNoStop(veh, opts, W) {
    const box = $('nostop'); if (!box) return;
    const need = opts.reserveEnd;
    const base = arrivalSoc(veh, opts);
    const ok = o => arrivalSoc(veh, o).soc >= o.reserveEnd - 1e-9;
    // 1) vitesse autoroute maximale sans arrêt (recherche dichotomique)
    const o100 = { ...opts, socStart: Math.max(opts.socStart, 1) };
    const fitSpeed = o => { let lo = 70, hi = o.speedHwy; if (!ok({ ...o, speedHwy: lo })) return null;
      while (hi - lo > 1) { const mid = Math.round((lo + hi) / 2); if (ok({ ...o, speedHwy: mid })) lo = mid; else hi = mid; } return lo; };
    const vMax = fitSpeed(opts), vMax100 = opts.socStart < 1 ? fitSpeed(o100) : vMax;
    // 2) autres leviers, à la vitesse choisie
    const levers = [];
    const pts = x => `${x >= 0 ? '+' : ''}${f0(x * 100)} pts`;
    if (opts.socStart < 1) { const a = arrivalSoc(veh, o100).soc; levers.push(['Partir à 100 %', a - base.soc, a > 0 ? `arrivée à ${f0(a * 100)} %` : 'insuffisant seul']); }
    let bestH = null;
    if (!W.manual) {
      const tLast = Math.max(...W.st[0].h.time) * 1000 - (base.r.totalH + 0.5) * 3600e3;
      for (let k = -6; k <= 12; k++) {
        const dep = opts.departMs + k * 3600e3; if (k === 0 || dep < Date.now() - 3600e3 * 24 * 365 || dep > tLast || dep < W.st[0].h.time[0] * 1000) continue;
        const a = arrivalSoc(veh, { ...opts, departMs: dep }).soc;
        if (!bestH || a > bestH.a) bestH = { a, dep };
      }
      if (bestH && bestH.a - base.soc > 0.005) levers.push([`Partir à ${clock(bestH.dep)} (météo plus favorable)`, bestH.a - base.soc, bestH.a > 0 ? `arrivée à ${f0(bestH.a * 100)} %` : 'insuffisant seul']);
    }
    let html;
    const short = base.soc - need;
    if (vMax == null && vMax100 == null) {
      html = `<p><b>Impossible sans arrêt avec ces conditions, même à 70 km/h.</b> Il manquerait environ ${f0(-short * 100)} points de % à l'arrivée (réserve ${f0(need * 100)} % incluse). Le plan avec recharge ci-dessus est le plus rapide ; un seul arrêt court à mi-parcours suffit souvent.</p>`;
    } else {
      const v = vMax ?? vMax100, needs100 = vMax == null;
      html = `<div class="opt"><div><div class="note">Vitesse autoroute maximale sans recharge${needs100 ? ', en partant à 100 %' : ''}, avec ${f0(need * 100)} % de réserve à l'arrivée</div><div class="big">${v} km/h</div></div>
        <button class="small" id="applyNoStop">Appliquer</button></div>
        <p class="note">${emptyTxt(base)} Le temps de route s'allonge, mais sans arrêt.${v < 90 ? ' Sous 90 km/h, reste dans la voie de droite (minimum légal 60 km/h sur l\'autoroute).' : ''}</p>`;
      box.dataset.v = v; box.dataset.full = needs100 ? '1' : '';
    }
    if (levers.length) html += `<h3 class="note" style="margin:12px 0 4px">Autres leviers à ${opts.speedHwy} km/h</h3>` + levers.map(l => `<div class="opt"><span>${esc(l[0])}</span><span class="gain ${l[1] >= 0 ? 'pos' : 'neg'}">${pts(l[1])} <span class="note">· ${l[2]}</span></span></div>`).join('');
    html += `<div class="opt"><span>Arriver avec moins de réserve</span><span class="gain">${base.soc > 0 ? `arrivée possible à ${f0(base.soc * 100)} %` : 'insuffisant seul'}</span></div>`;
    box.className = 'card nostop'; box.innerHTML = `<h2>Trajet sans arrêt</h2>${html}`;
    const ap = $('applyNoStop');
    if (ap) ap.onclick = () => { $('speed').value = box.dataset.v; if (box.dataset.full) $('soc0').value = 100; run(); };
  }

  function avgRho(r) { let s = 0, d = 0; for (const x of r.seg) { s += S.airDensity(x.wx.T, x.wx.p, x.wx.rh) * x.d; d += x.d; } return s / d; }

  function wxRows(r) {
    const rows = [];
    for (const leg of [0, 1]) {
      const segs = r.seg.filter(s => s.leg === leg);
      const L0 = segs[0].km0, L1 = segs[segs.length - 1].km1;
      for (let i = 0; i < 6; i++) {
        const km = leg === 0 ? L0 + (L1 - L0) * i / 5 : L0 + (L1 - L0) * i / 5;
        const s = segs.reduce((b, x) => Math.abs(x.km0 - km) < Math.abs(b.km0 - km) ? x : b);
        const w = s.wx;
        rows.push(`<tr><td>${placeName(s.lat, s.lon)} <span class="note">km ${f0(s.km0)}</span></td><td>${leg ? 'Retour' : 'Aller'}</td><td>${clock(s.tMs)}</td><td>${f1(w.T)} °C</td>
          <td><span class="arrow" style="transform:rotate(${(w.wd + 180) % 360}deg)">↑</span> ${f0(w.ws)} km/h ${compass(w.wd)}</td>
          <td>${s.head >= 0 ? 'de face' : 'arrière'} ${f0(Math.abs(s.head))}</td><td>${f0(w.p)} hPa</td><td>${f0(w.rh)} %</td><td>${w.snow > 0.05 ? f1(w.snow) + ' cm neige' : w.precip > 0.05 ? f1(w.precip) + ' mm' : '—'}</td></tr>`);
      }
    }
    return rows.join('');
  }

  function drawChart(r, opts, turnKm) {
    const el = $('socchart'), W = Math.max(320, el.clientWidth), Hh = 260, m = { l: 38, r: 10, t: 12, b: 28 };
    const X = km => m.l + km / r.totalKm * (W - m.l - m.r), Y = soc => m.t + (1 - soc) * (Hh - m.t - m.b);
    const P = ROUTE.points, emin = Math.min(...P.map(p => p.ele)), emax = Math.max(...P.map(p => p.ele));
    const EY = e => Hh - m.b - (e - emin) / (emax - emin || 1) * (Hh - m.t - m.b) * 0.35;
    let elev = `M${X(0)},${Hh - m.b}` + P.map(p => `L${X(p.km).toFixed(1)},${EY(p.ele).toFixed(1)}`).join('') + `L${X(r.totalKm)},${Hh - m.b}Z`;
    const line = r.socTrace.map((p, i) => `${i ? 'L' : 'M'}${X(p.km).toFixed(1)},${Y(Math.max(0, p.soc)).toFixed(1)}`).join('');
    const grid = [0, .2, .4, .6, .8, 1].map(s => `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(s)}" y2="${Y(s)}" stroke="var(--line)"/><text x="${m.l - 6}" y="${Y(s) + 4}" text-anchor="end">${s * 100}%</text>`).join('');
    const xt = [0, 100, 200, 300, 400, 500].filter(k => k <= r.totalKm).map(k => `<text x="${X(k)}" y="${Hh - 8}" text-anchor="middle">${k} km</text>`).join('');
    const avail = ROUTE.chargers.filter(c => c.kw >= opts.minChargerKw && (!c.tesla_only || opts.teslaAccess));
    const ticks = avail.map(c => `<line x1="${X(c.km)}" x2="${X(c.km)}" y1="${Hh - m.b}" y2="${Hh - m.b + 5}" stroke="var(--muted)" stroke-width="2"><title>${esc(c.name)} · ${c.kw} kW</title></line>`).join('');
    const stops = r.stops.map(s => `<line x1="${X(s.km)}" x2="${X(s.km)}" y1="${Y(s.depSoc)}" y2="${Y(s.arrSoc)}" stroke="var(--brand)" stroke-width="6" stroke-linecap="round"><title>${esc(s.node.name)} : ${Math.round(s.arrSoc * 100)} → ${Math.round(s.depSoc * 100)} %</title></line>`).join('');
    const res = `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(opts.reserveCharger)}" y2="${Y(opts.reserveCharger)}" stroke="var(--bad)" stroke-dasharray="4 4" opacity=".6"/>`;
    const turn = `<line x1="${X(turnKm)}" x2="${X(turnKm)}" y1="${m.t}" y2="${Hh - m.b}" stroke="var(--muted)" stroke-dasharray="3 3"/><text x="${X(turnKm) + 4}" y="${m.t + 10}">Sortie 314 · demi-tour</text>`;
    el.innerHTML = `<svg width="100%" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="État de charge selon la distance"><path d="${elev}" fill="var(--muted)" opacity=".13"/>${grid}${res}${turn}<path d="${line}" fill="none" stroke="var(--soc)" stroke-width="2.5" stroke-linejoin="round"/>${stops}${ticks}${xt}</svg>`;
  }

  function drawSvgMap(r, opts) {
    // Projection Web Mercator (zoom 10, pixels) pour s'aligner sur le fond OpenStreetMap figé (data/basemap.jpg)
    const el = $('map'); el.style.height = 'auto';
    const n = 256 * 2 ** 10, mx = lon => (lon + 180) / 360 * n,
      my = lat => { const t = lat * Math.PI / 180; return (1 - Math.log(Math.tan(t) + 1 / Math.cos(t)) / Math.PI) / 2 * n; };
    const P = ROUTE.points.filter(p => p.leg === 0);
    let B = window.BASEMAP;
    if (!B) { const xs = P.map(p => mx(p.lon)), ys = P.map(p => my(p.lat)), m = 40;
      B = { x0: Math.min(...xs) - m, y0: Math.min(...ys) - m, w: Math.max(...xs) - Math.min(...xs) + 2 * m, h: Math.max(...ys) - Math.min(...ys) + 2 * m }; }
    const W = B.w, Hh = B.h, k = W / 720;    // k : symboles dimensionnés comme sur une carte de 720 px
    const X = lon => mx(lon) - B.x0, Y = lat => my(lat) - B.y0;
    const path = P.map((p, i) => `${i ? 'L' : 'M'}${X(p.lon).toFixed(1)},${Y(p.lat).toFixed(1)}`).join('');
    const seen = new Set(); let ch = '';
    for (const c of ROUTE.chargers) {
      const key = c.lat + ',' + c.lon; if (seen.has(key)) continue; seen.add(key);
      const ok = c.kw >= opts.minChargerKw && (!c.tesla_only || opts.teslaAccess);
      ch += `<circle cx="${X(c.lon).toFixed(1)}" cy="${Y(c.lat).toFixed(1)}" r="${6 * k}" fill="#fff" stroke="${ok ? '#1d2330' : '#9aa3b0'}" stroke-width="${2.5 * k}"><title>${esc(c.name)} · ${c.kw} kW${c.kw_known ? '' : ' (supposé)'}${ok ? '' : ' · exclue'}</title></circle>`;
    }
    const stops = r.stops.map((s, i) => `<g><circle cx="${X(s.node.lon)}" cy="${Y(s.node.lat)}" r="${17 * k}" fill="var(--brand)" stroke="#111" stroke-width="${3 * k}"/><text x="${X(s.node.lon)}" y="${Y(s.node.lat) + 7 * k}" text-anchor="middle" font-size="${20 * k}" font-weight="800" style="fill:#111">${i + 1}</text><title>Arrêt ${i + 1} : ${esc(s.node.name)} · ${Math.round(s.arrSoc * 100)} → ${Math.round(s.depSoc * 100)} %</title></g>`).join('');
    const o = ROUTE.origin, e = ROUTE.exit314, sq = 18 * k;
    const lbl = (x, y, t, anchor) => `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${20 * k}" font-weight="700" stroke="#fff" stroke-width="${5 * k}" paint-order="stroke" style="fill:#111">${t}</text>`;
    const bg = window.BASEMAP ? `<image href="data/basemap.jpg" x="0" y="0" width="${W}" height="${Hh}" preserveAspectRatio="none" class="basemap"/>` : '';
    el.innerHTML = `<svg viewBox="0 0 ${W} ${Hh}" width="100%" style="max-height:620px;display:block;margin:auto;border-radius:10px" role="img" aria-label="Carte du trajet et des bornes">
      ${bg}<path d="${path}" fill="none" stroke="#fff" stroke-width="${12 * k}" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/>
      <path d="${path}" fill="none" stroke="#2f62d0" stroke-width="${7 * k}" stroke-linecap="round" stroke-linejoin="round"/>${ch}
      <rect x="${X(o[1]) - sq / 2}" y="${Y(o[0]) - sq / 2}" width="${sq}" height="${sq}" fill="#111" stroke="#fff" stroke-width="${2 * k}"><title>2600 rue Léger, LaSalle</title></rect>
      <rect x="${X(e[1]) - sq / 2}" y="${Y(e[0]) - sq / 2}" width="${sq}" height="${sq}" fill="#111" stroke="#fff" stroke-width="${2 * k}"><title>A-20 sortie 314, demi-tour</title></rect>
      ${lbl(X(o[1]) + 16 * k, Y(o[0]) - 14 * k, 'Départ : LaSalle', 'start')}${lbl(X(e[1]) - 14 * k, Y(e[0]) + 34 * k, 'Sortie 314 (Lévis)', 'end')}${stops}
      ${window.BASEMAP ? `<text x="${W - 8 * k}" y="${Hh - 8 * k}" text-anchor="end" font-size="${13 * k}" stroke="#fff" stroke-width="${4 * k}" paint-order="stroke" style="fill:#333">© contributeurs d'OpenStreetMap</text>` : ''}</svg>`;
  }

  function drawMap(r, opts) {
    const el = $('map'); if (!window.L || window.EVRM_ARTIFACT) { drawSvgMap(r, opts); return; }
    if (map) { map.remove(); map = null; }
    map = L.map(el, { scrollWheelZoom: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 18 }).addTo(map);
    const P = ROUTE.points.filter(p => p.leg === 0).map(p => [p.lat, p.lon]);
    const line = L.polyline(P, { color: '#3b6fd8', weight: 4 }).addTo(map);
    mapBounds = line.getBounds(); map.fitBounds(mapBounds, { padding: [20, 20] });
    const seen = new Set();
    for (const c of ROUTE.chargers) {
      const k = c.lat + ',' + c.lon; if (seen.has(k)) continue; seen.add(k);
      const ok = c.kw >= opts.minChargerKw && (!c.tesla_only || opts.teslaAccess);
      L.circleMarker([c.lat, c.lon], { radius: 5, color: ok ? '#555' : '#aaa', fillColor: ok ? '#fff' : '#ddd', fillOpacity: 1, weight: 2 })
        .bindTooltip(`${esc(c.name)}<br>${esc(c.operator || '')} · ${c.kw} kW${c.kw_known ? '' : ' (supposé)'}${ok ? '' : ' · exclue'}`).addTo(map);
    }
    r.stops.forEach((s, i) => L.marker([s.node.lat, s.node.lon], { icon: L.divIcon({ className: '', html: `<div style="background:#ffd500;color:#111;border:2px solid #111;border-radius:50%;width:26px;height:26px;display:grid;place-items:center;font-weight:800">${i + 1}</div>`, iconSize: [26, 26] }) })
      .bindTooltip(`Arrêt ${i + 1} (${s.km < 259 ? 'aller' : 'retour'}) : ${esc(s.node.name)}<br>${Math.round(s.arrSoc * 100)} → ${Math.round(s.depSoc * 100)} % · ${Math.round(s.chargeMin)} min`).addTo(map));
    L.marker(ROUTE.origin, { title: 'Départ / arrivée' }).bindTooltip('2600 rue Léger, LaSalle').addTo(map);
    L.marker(ROUTE.exit314, { title: 'Sortie 314' }).bindTooltip('A-20 sortie 314 (Lévis) · demi-tour').addTo(map);
  }

  // ---------- CSV RNCan plus récent ----------
  function parseCSV(text) {
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    const hdr = rows.shift().map(h => h.replace(/^﻿/, '').trim());
    const ix = n => hdr.findIndex(h => h.toLowerCase().startsWith(n.toLowerCase()));
    const I = { y: ix('Model year'), mk: ix('Make'), md: ix('Model'), c: ix('Vehicle class'), kw: ix('Motor'), ci: ix('City (kWh'), hw: ix('Highway (kWh'), co: ix('Combined (kWh'), rg: ix('Range'), l2: ix('Recharge time') };
    if (Object.values(I).some(v => v < 0)) throw new Error('Colonnes RNCan non reconnues (fichier « Battery Electric Vehicles » attendu).');
    return rows.filter(r => r.length > 5).map(r => ({ year: +r[I.y], make: r[I.mk].trim(), model: r[I.md].trim(), cls: r[I.c].trim(), kw: +r[I.kw], city: +r[I.ci], hwy: +r[I.hw], comb: +r[I.co], range: +r[I.rg], l2h: +r[I.l2] }))
      .filter(r => r.year && r.hwy && r.range);
  }
  $('loadcsv').onclick = e => { e.preventDefault(); $('csvfile').click(); };
  $('csvfile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { RN = parseCSV(await f.text()); rnFile = f.name; fillModels(); selected = null; chosen = null; $('model').value = ''; syncClear(); validate(); }
    catch (err) { $('runerr').innerHTML = `<div class="err">${esc(err.message)}</div>`; }
  };

  // ---------- Init ----------
  fillModels();
  $('rtkm').textContent = f1(ROUTE.points[ROUTE.points.length - 1].km);
  $('nch').textContent = new Set(ROUTE.chargers.map(c => c.lat + ',' + c.lon)).size;
  const now = new Date(); now.setDate(now.getDate() + (now.getHours() >= 9 ? 1 : 0));
  $('date').value = ymd(now);
  const setTires = () => { const d = new Date($('date').value + 'T12:00'); const md = (d.getMonth() + 1) * 100 + d.getDate(); $('winter').checked = md >= 1115 || md <= 415; };
  setTires(); $('date').addEventListener('change', setTires);
  $('selYear').onchange = () => { const mk = $('selMake').value, md = chosen && chosen.model; fillMakes(mk); const i = fillVersions(md); choose(i ? RN[+i] : null); };
  $('selMake').onchange = () => { const md = chosen && chosen.model; const i = fillVersions(md); choose(i ? RN[+i] : null); };
  $('selModel').onchange = () => { const i = $('selModel').value; choose(i ? RN[+i] : null); };
  $('clearModel').onclick = () => { $('selYear').value = ''; fillMakes(); fillVersions(); autoRange = true; choose(null); $('selYear').focus(); };
  $('rangeIn').addEventListener('input', () => { autoRange = !$('rangeIn').value; validate(); });
  $('wxmode').querySelectorAll('button').forEach(b => b.onclick = () => {
    wxMode = b.dataset.m; $('wxmode').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    $('wxauto').style.display = wxMode === 'auto' ? '' : 'none'; $('wxmanual').style.display = wxMode === 'manual' ? '' : 'none';
  });
  if (window.EVRM_ARTIFACT && window.WX_SNAPSHOT) {
    const T = window.WX_SNAPSHOT.st[0].h.time, f = ms => new Date(ms).toLocaleDateString('fr-CA', { day: 'numeric', month: 'long' });
    $('wxauto').textContent = `Instantané Open-Meteo pris le ${window.WX_SNAPSHOT.fetched} (modèles GEM d'Environnement Canada, GFS, ECMWF) : température, vent à 10 m, pression, humidité et précipitations à l'heure de passage, en 10 points du trajet. Dates possibles : du ${f(T[0] * 1000)} au ${f(T[T.length - 1] * 1000 - 8 * 3600e3)}.`;
  }
  Order.apply(document.querySelector('aside')); Order.applyFolds(document.querySelector('footer')); Order.syncReset();
  $('resetOrder').onclick = Order.reset;
  // Téléphone : deux onglets (Réglages / Résultats) au lieu d'une longue page
  const mobile = () => matchMedia('(max-width: 640px)').matches;
  function setView(v) {
    document.body.classList.toggle('v-in', v === 'in'); document.body.classList.toggle('v-out', v === 'out');
    document.querySelectorAll('.mtabs button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
    if (mobile()) window.scrollTo({ top: 0, behavior: 'instant' });
    window.dispatchEvent(new Event('resize'));
    // une carte Leaflet créée pendant que l'onglet était caché doit être recadrée une fois visible
    if (v === 'out' && map && mapBounds) setTimeout(() => { map.invalidateSize(); map.fitBounds(mapBounds, { padding: [20, 20] }); }, 0);
  }
  document.querySelectorAll('.mtabs button').forEach(b => b.onclick = () => setView(b.dataset.v));
  setView('in');
  // textes d'aide sur une ligne au téléphone : toucher pour lire au complet
  document.addEventListener('click', e => { const h = e.target.closest('.hint, .valid .specs'); if (h && mobile() && !e.target.closest('a,button,input,select')) h.classList.toggle('open'); });
  $('run').onclick = async () => { await run(); if (mobile() && !$('runerr').textContent) setView('out'); };
  // exemple au premier affichage (remplacé dès qu'on entre un autre véhicule)
  if (!$('model').value) {
    const ex = RN.find(r => label(r) === '2025 Hyundai IONIQ 5 Long Range AWD (19" Wheels)') || RN[0];
    setRow(ex); run();
  }
  syncClear();
})();
