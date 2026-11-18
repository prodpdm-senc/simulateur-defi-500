"""Construit data/route.json : itinéraire fixe (2600 rue Léger -> sortie 314 A-20 E -> retour),
pentes (Open-Meteo elevation) et bornes de recharge rapide le long du trajet (OpenStreetMap/Overpass).
Usage : python3 scripts/build_route.py"""
import json, math, urllib.parse, os, time, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); DATA = os.path.join(HERE, '..', 'data')
UA = {'User-Agent': 'EVRangeMagic/1.0'}
ORIGIN = (45.44570, -73.62770)           # 2600-2604 rue Léger, LaSalle (H8N 2V9), entre le 2555 et le 2611 (adresses OSM)
EXIT314 = (46.7247128, -71.2780197)      # A-20 sortie 314 (av. des Églises / ch. du Sault, Lévis)

def get(url, data=None):
    # curl plutôt qu'urllib : le Python de python.org n'a pas toujours les certificats SSL installés
    cmd = ['curl', '-sS', '--max-time', '180', '-A', UA['User-Agent'], url]
    if data is not None: cmd += ['--data-binary', '@-']
    out = subprocess.run(cmd, input=data, capture_output=True, check=True).stdout
    return json.loads(out)

def hav(a, b):
    R = 6371000; p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp = p2 - p1; dl = math.radians(b[1] - a[1])
    h = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(math.sqrt(h))

def bearing(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0]); dl = math.radians(b[1]-a[1])
    x = math.sin(dl)*math.cos(p2); y = math.cos(p1)*math.sin(p2) - math.sin(p1)*math.cos(p2)*math.cos(dl)
    return (math.degrees(math.atan2(x, y)) + 360) % 360

def target_speed(step):
    name, ref = step.get('name', ''), step.get('ref', '')
    if 'Champlain' in name or ref.startswith('15'): return 90    # A-15 / pont Champlain (limite 70-90, circulation fluide)
    if ref.startswith('10'): return 105                          # A-10 près de Brossard
    if 'Autoroute' in name: return 110                           # A-30, A-20
    return None  # rues et bretelles : vitesse OSRM

o = f"{ORIGIN[1]},{ORIGIN[0]}"; d = f"{EXIT314[1]},{EXIT314[0]}"
r = get(f"https://router.project-osrm.org/route/v1/driving/{o};{d};{o}?overview=false&geometries=geojson&steps=true")['routes'][0]

raw = []  # (lat, lon, speed_kmh, leg)
for li, leg in enumerate(r['legs']):
    for s in leg['steps']:
        coords = s['geometry']['coordinates']
        if s['distance'] <= 0 or len(coords) < 2: continue
        v = target_speed(s) or min(90, max(30, s['distance'] / max(s['duration'], 1) * 3.6))
        for c in coords: raw.append((c[1], c[0], v, li))

# Ré-échantillonnage ~400 m
pts = [raw[0]]; last = raw[0]; dist_since = 0
for p in raw[1:]:
    dist_since += hav(last[:2], p[:2]); last = p
    if dist_since >= 400 or p is raw[-1]: pts.append(p); dist_since = 0

# Altitudes (mises en cache : l'API gratuite limite le nombre d'appels par minute)
cache = os.path.join(DATA, '.elev_cache.json')
elev = json.load(open(cache)) if os.path.exists(cache) else []
if len(elev) != len(pts): elev = []
for i in (range(0, len(pts), 100) if not elev else []):
    chunk = pts[i:i+100]
    q = urllib.parse.urlencode({'latitude': ','.join(f"{p[0]:.5f}" for p in chunk), 'longitude': ','.join(f"{p[1]:.5f}" for p in chunk)})
    for attempt in range(8):
        res = get('https://api.open-meteo.com/v1/elevation?' + q)
        if 'elevation' in res: elev += res['elevation']; break
        print('Open-Meteo :', res.get('reason'), '— nouvel essai dans 65 s'); time.sleep(65)
    else: raise SystemExit('Altitudes indisponibles')
    time.sleep(2)

json.dump(elev, open(cache, 'w'))
route = []; cum = 0
for i, p in enumerate(pts):
    if i: cum += hav(pts[i-1][:2], p[:2])
    route.append({'lat': round(p[0], 5), 'lon': round(p[1], 5), 'km': round(cum/1000, 3), 'ele': elev[i], 'v': round(p[2]), 'leg': p[3]})

# Bornes rapides (OSM) près du trajet
line = ','.join(f"{p['lat']},{p['lon']}" for p in route[::10] if p['leg'] == 0)
q = f'[out:json][timeout:120];nwr[amenity=charging_station](around:2500,{line});out center tags;'
ocache = os.path.join(DATA, '.overpass_cache.json')
els = json.load(open(ocache)) if os.path.exists(ocache) and time.time() - os.path.getmtime(ocache) < 86400 else None
for attempt in (range(10) if els is None else []):
    pass
for attempt in (range(10) if els is None else []):   # Overpass est souvent saturé : on réessaie avec un délai croissant
    for ep in ('https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'):
        try:
            els = get(ep, urllib.parse.urlencode({'data': q}).encode())['elements']; break
        except Exception as e:
            print('Overpass occupé (', ep, ')')
    if els is not None: break
    time.sleep(min(30 * 2**attempt, 300))
if els is None: raise SystemExit('Overpass indisponible, réessayer plus tard')
json.dump(els, open(ocache, 'w'))
print(len(els), 'bornes OSM (toutes puissances) près du trajet')
def is_dc(t):
    nm = (t.get('name', '') + ' ' + t.get('brand', '')).lower()
    if 'brcc' in nm or (kw(t) or 0) >= 24: return True
    return any(k.startswith(('socket:type2_combo', 'socket:type1_combo', 'socket:chademo', 'socket:tesla_supercharger', 'socket:nacs')) for k in t) \
        or 'supercharger' in (t.get('name', '') + t.get('brand', '')).lower() or 'rapide' in t.get('name', '').lower() \
        or 'fast' in t.get('name', '').lower()
def kw(t):
    best = 0
    for k, v in t.items():
        if k.endswith(':output') or k == 'charging_station:output':
            for part in v.replace(',', ';').split(';'):
                try: best = max(best, float(part.lower().replace('kw', '').strip()))
                except ValueError: pass
    return best or None
def kw_guess(t):
    k = kw(t)
    if k: return k
    nm = (t.get('name', '') + ' ' + t.get('brand', '')).lower()
    return 250.0 if 'supercharger' in nm else 50.0   # inconnu : V3 Tesla, sinon 50 kW (prudent)
def place(c, lat, lon, max_m=2500):
    """Ajoute une borne sur chaque branche du trajet où elle est à moins de max_m mètres."""
    out = []
    for leg in (0, 1):
        best = min((p for p in route if p['leg'] == leg), key=lambda p: hav((lat, lon), (p['lat'], p['lon'])))
        dd = hav((lat, lon), (best['lat'], best['lon']))
        if dd <= max_m:
            out.append({**c, 'lat': round(lat, 5), 'lon': round(lon, 5), 'leg': leg, 'km': best['km'], 'detour_km': round(2 * dd / 1000, 1)})
    return out

# 1) Base officielle des stations (RNCan / AFDC, via l'API NLR) : bornes rapides du Québec, puissance par connecteur
afdc_path = os.path.join(DATA, 'afdc_qc_dcfc.json')
if not os.path.exists(afdc_path) or time.time() - os.path.getmtime(afdc_path) > 7 * 86400:
    subprocess.run(['curl', '-sS', '-m', '180', '-o', afdc_path, 'https://developer.nlr.gov/api/alt-fuel-stations/v1.json?api_key=DEMO_KEY'
                    '&fuel_type=ELEC&country=CA&state=QC&ev_charging_level=dc_fast&limit=all'], check=True)
afdc = json.load(open(afdc_path))['fuel_stations']
DEFAULT_KW = {'Tesla': 250.0}
chargers = []
for st in afdc:
    units = st.get('ev_charging_units') or []
    ccs = [c.get('power_kw') for u in units for k, c in u['connectors'].items() if k == 'J1772COMBO' and c.get('port_count')]
    nacs = [c.get('power_kw') for u in units for k, c in u['connectors'].items() if k == 'TESLA' and c.get('port_count')]
    has_ccs = bool(ccs) or 'J1772COMBO' in (st.get('ev_connector_types') or [])
    tesla = st['ev_network'] == 'Tesla'
    kws = [k for k in (nacs if tesla else ccs) if k] or [k for k in ccs + nacs if k]
    kw_ = max(kws) if kws else DEFAULT_KW.get(st['ev_network'], 50.0)
    if not tesla and not has_ccs: continue          # CHAdeMO seulement : ignoré
    chargers += place({'name': st['station_name'].replace('MarchÃ©', 'Marché'), 'operator': st['ev_network'].replace('_', ' ').title() if st['ev_network'].isupper() else st['ev_network'],
                       'kw': round(kw_), 'kw_known': bool(kws), 'ports': st.get('ev_dc_fast_num'),
                       'tesla_only': tesla and not has_ccs, 'src': 'RNCan/AFDC'}, st['latitude'], st['longitude'])
n_afdc = len(chargers)

# 2) OpenStreetMap : seulement les bornes qui ne sont pas déjà dans la base officielle (à moins de 250 m)
def dup(lat, lon, tesla_only, pool, m=250, operator=None):
    return any(c['tesla_only'] == tesla_only and (operator is None or c['operator'] == operator)
               and hav((lat, lon), (c['lat'], c['lon'])) < m for c in pool)
for e in els:
    t = e.get('tags', {}); lat = e.get('lat') or e['center']['lat']; lon = e.get('lon') or e['center']['lon']
    if not is_dc(t): continue
    tesla_only = 'supercharger' in (t.get('name', '') + t.get('brand', '')).lower() and 'yes' != t.get('access:nontesla', '')
    if dup(lat, lon, tesla_only, chargers): continue
    chargers += place({'name': t.get('name') or t.get('operator') or t.get('brand') or 'Borne rapide',
                       'operator': t.get('operator') or t.get('network') or t.get('brand') or '',
                       'kw': kw_guess(t), 'kw_known': bool(kw(t)), 'tesla_only': tesla_only, 'src': 'OpenStreetMap'}, lat, lon)

# 3) Sites absents des deux sources, ajoutés à la main (source indiquée)
SUPPLEMENT = [
    {'name': "BRCC - Saint-Louis-de-Blandford - Halte La Porte de l'Érable (sortie 228)", 'operator': 'Circuit électrique',
     'lat': 46.21866, 'lon': -72.05286, 'kw': 350.0,
     'note': "2 bornes ABB 350 kW, 8 de 180 kW (puissance partagée) et 4 de 50 kW, selon Hydro-Québec (27 mars 2024)"},
    {'name': 'Recharge Sprint - Saint-Apollinaire (470, route 273)', 'operator': 'Recharge Sprint', 'lat': 46.61643, 'lon': -71.51643,
     'kw': 280.0, 'kw400': 140.0, 'ports': 6,
     'note': "Kempower, 280 kW partagés en 800 V, 140 kW en 400 V (fiche du réseau Sprint, PlugShare); 6 prises CCS (ChargeHub)"},
    {'name': 'Recharge Sprint - St-Nicolas (ch. Olivier)', 'operator': 'Recharge Sprint', 'lat': 46.67948, 'lon': -71.34556,
     'kw': 280.0, 'kw400': 140.0, 'ports': 4,
     'note': "1230, chemin Olivier (sortie 305) : 4 bornes Kempower de 280 kW en partage de puissance (app Recharge Sprint, capture d'Alex 2026-11-17); 140 kW en 400 V"},
]
for sup in SUPPLEMENT:
    if dup(sup['lat'], sup['lon'], False, chargers, 300, sup['operator']): continue
    chargers += place({**{k: v for k, v in sup.items() if k not in ('lat', 'lon')}, 'kw_known': True, 'tesla_only': False, 'src': 'ajout manuel'}, sup['lat'], sup['lon'])
print(f"bornes rapides retenues : {n_afdc} (RNCan/AFDC) + {len(chargers) - n_afdc} (OSM et ajouts manuels)")
chargers.sort(key=lambda c: c['km'])
out = {'built': time.strftime('%Y-%m-%d'), 'source': 'OSRM (OpenStreetMap), Open-Meteo elevation, RNCan/AFDC, Overpass, ajouts manuels',
       'origin': ORIGIN, 'exit314': EXIT314, 'points': route, 'chargers': chargers}
# supprimer les doublons (même site sur 2 branches gardé, mais pas 2 fois la même borne sur une branche)
seen = set(); uniq = []
for c in chargers:
    key = (c['leg'], round(c['lat'], 4), round(c['lon'], 4), c['tesla_only'], c['name'])
    if key not in seen: seen.add(key); uniq.append(c)
out['chargers'] = uniq; chargers = uniq
json.dump(out, open(os.path.join(DATA, 'route.json'), 'w'), ensure_ascii=False)
with open(os.path.join(DATA, 'route.js'), 'w') as f:
    f.write('window.ROUTE = ' + json.dumps(out, ensure_ascii=False) + ';\n')
print(len(route), 'points', route[-1]['km'], 'km;', len(chargers), 'bornes')
for c in chargers:
    if c['leg'] == 0: print(round(c['km']), c['kw'], c.get('kw400', ''), c['name'][:60], '|', c['operator'], c['detour_km'], 'TESLA' if c['tesla_only'] else '', c['src'])
