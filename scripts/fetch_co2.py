#!/usr/bin/env python3
"""
fetch_co2.py — haalt de CO2-emissiefactor van de Nederlandse elektriciteitsmix
per uur op bij het Nationaal Energie Dashboard (NED.nl) en schrijft hem naar
data/raw/ned_co2_uur.csv, als invoer voor scripts/build_assets.py.

Bron: https://api.ned.nl/v1/utilizations, type 27 (ElectricityMix, de totale
Nederlandse opwek), activity providing, uurwaarden, UTC-instants. Per uur geeft
NED het geproduceerde volume (kWh), de uitstoot (kg) en de emissiefactor
(kg/kWh) die daaruit volgt: de gemiddelde uitstoot van één kWh die op dat uur
in Nederland werd opgewekt. Import telt daarin niet mee; zie de README.

Parameters en valkuilen volgen de energiedata-nl skill (~/code/anwb-skills/
energiedata-nl/references/ned.md): X-AUTH-TOKEN plus een echte User-Agent,
itemsPerPage 200 met Hydra-paginering, 200 verzoeken per vijf minuten.

Gebruik:
    /opt/homebrew/bin/python3.13 scripts/fetch_co2.py            # 2023-01-01 tot vandaag
    /opt/homebrew/bin/python3.13 scripts/fetch_co2.py --start 2025-01-01

De systeem-Python van macOS (3.9, oude OpenSSL) krijgt van api.ned.nl een
TLS-fout ("tlsv1 alert protocol version"); een Homebrew-Python werkt. De sleutel
is de publieke sleutel uit de skill; overschrijven kan met NED_API_KEY.
Bestaande uren in het CSV blijven staan; alleen ontbrekende maanden worden
opgehaald, zodat een herhaalde run alleen het lopende jaar bijwerkt.
"""
import argparse
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

BASE = "https://api.ned.nl/v1/utilizations"
UIT = "data/raw/ned_co2_uur.csv"
SLEUTEL = os.environ.get(
    "NED_API_KEY",
    "9c2b2d32890b7593cf5b99177a075079ba11fef59745501f7b3d3a76380732e1",
)
VELDEN = ["validfrom_utc", "volume_kwh", "emission_kg", "emissionfactor_kg_per_kwh"]

# 200 verzoeken per vijf minuten; een maand uurdata is vier pagina's.
_aanroepen: list[float] = []


def wacht_op_limiet() -> None:
    nu = time.time()
    _aanroepen[:] = [t for t in _aanroepen if nu - t < 300]
    if len(_aanroepen) >= 190:
        pauze = 300 - (nu - _aanroepen[0]) + 1
        print(f"  [rate-limit] pauze {pauze:.0f}s", file=sys.stderr)
        time.sleep(max(pauze, 0))
        _aanroepen.clear()
    _aanroepen.append(time.time())


def haal(url: str, pogingen: int = 4) -> dict:
    req = urllib.request.Request(url, headers={
        "X-AUTH-TOKEN": SLEUTEL,
        "Accept": "application/ld+json",
        "User-Agent": "thuisbatterij-rekentool/1.0 (+https://ned.nl)",
    })
    laatste: Exception | None = None
    for poging in range(pogingen):
        wacht_op_limiet()
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            laatste = e
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(2 ** poging)
                continue
            raise
        except urllib.error.URLError as e:
            laatste = e
            if "TLSV1_ALERT_PROTOCOL_VERSION" in str(e.reason):
                raise SystemExit(
                    "TLS-fout van api.ned.nl: deze Python heeft een te oude OpenSSL. "
                    "Draai het script met /opt/homebrew/bin/python3.13."
                )
            time.sleep(2 ** poging)
    raise SystemExit(f"mislukt na {pogingen} pogingen: {laatste}")


def maand(start: date, eind: date) -> list[dict]:
    """Alle uurrecords met validfrom in [start, eind)."""
    params = {
        "point": 0, "type": 27, "granularity": 5, "granularitytimezone": 0,
        "classification": 2, "activity": 1,
        "validfrom[after]": start.isoformat(),
        "validfrom[strictly_before]": eind.isoformat(),
        "itemsPerPage": 200,
    }
    url = BASE + "?" + urllib.parse.urlencode(params)
    records: list[dict] = []
    while url:
        d = haal(url)
        for x in d.get("hydra:member", []):
            records.append({
                "validfrom_utc": x["validfrom"],
                "volume_kwh": x.get("volume"),
                "emission_kg": x.get("emission"),
                "emissionfactor_kg_per_kwh": x.get("emissionfactor"),
            })
        volgende = (d.get("hydra:view") or {}).get("hydra:next")
        url = ("https://api.ned.nl" + volgende) if volgende else None
    return records


def lees_bestaand() -> dict[str, dict]:
    if not os.path.exists(UIT):
        return {}
    with open(UIT, newline="") as fh:
        return {r["validfrom_utc"]: r for r in csv.DictReader(fh)}


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--start", default="2023-01-01")
    p.add_argument("--eind", default=None, help="exclusief; standaard morgen")
    p.add_argument("--vers", action="store_true", help="haal ook maanden die er al staan opnieuw op")
    a = p.parse_args()
    start = date.fromisoformat(a.start)
    eind = date.fromisoformat(a.eind) if a.eind else datetime.now(timezone.utc).date() + timedelta(days=1)

    bestaand = lees_bestaand()
    print(f"bestaand: {len(bestaand)} uren in {UIT}", file=sys.stderr)

    m = start.replace(day=1)
    nieuw = 0
    while m < eind:
        volgend = (m.replace(day=28) + timedelta(days=4)).replace(day=1)
        van = max(m, start)
        tot = min(volgend, eind)
        # Een maand die al vol staat slaan we over, behalve de laatste twee
        # (die kunnen nog aangroeien of herberekend zijn).
        uren_verwacht = int((datetime.combine(tot, datetime.min.time()) - datetime.combine(van, datetime.min.time())).total_seconds() // 3600)
        aanwezig = sum(1 for k in bestaand if van.isoformat() <= k[:10] < tot.isoformat())
        lopend = volgend >= eind - timedelta(days=62)
        if not a.vers and not lopend and aanwezig >= uren_verwacht - 2:
            m = volgend
            continue
        recs = maand(van, tot)
        for r in recs:
            bestaand[r["validfrom_utc"]] = r
        nieuw += len(recs)
        print(f"  {van} – {tot}: {len(recs)} uren", file=sys.stderr)
        m = volgend

    os.makedirs(os.path.dirname(UIT), exist_ok=True)
    with open(UIT, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=VELDEN)
        w.writeheader()
        for k in sorted(bestaand):
            w.writerow({v: bestaand[k].get(v) for v in VELDEN})
    print(f"geschreven: {len(bestaand)} uren ({nieuw} opgehaald) naar {UIT}", file=sys.stderr)


if __name__ == "__main__":
    main()
