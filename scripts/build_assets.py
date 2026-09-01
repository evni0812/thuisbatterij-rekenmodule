#!/usr/bin/env python3
"""
Bouw de statische assets voor de webapp uit de ruwe data in data/raw/.

Twee soorten output in public/data/:
  prices-<jaar>.bin            marktprijs en allInPrijs per uur, EUR/kWh
  profile-<gebied>-<jaar>.bin  E17- en E18-fracties per kwartier, genormaliseerd
  manifest.json                periode, netgebieden, normalisatiefactoren,
                               kwartieraantallen en verificatiestatus

── Waarom normaliseren ─────────────────────────────────────────────────────
DYNAMIC-profielfracties sommeren NIET op 1 over een kalenderjaar. Gemeten voor
netgebied 871685900000056162 over heel 2025: E1A/AMI/E17 komt op 1,01779 en
E1A/AMI/E18 op 1,04954. Dat komt doordat DYNAMIC dagelijks wordt herberekend
tegen een verwacht jaarvolume, niet achteraf tegen het gerealiseerde jaar.

De app rekent met volume[t] = jaarvolume * fractie[t]. Zonder normalisatie zou
een gebruiker die 2500 kWh invult er 2544 toebedeeld krijgen. Daarom schalen we
elke reeks per kalenderjaar naar som exact 1 en leggen we de gebruikte factor in
het manifest vast.

Let op: een DEELPERIODE mag nooit opnieuw genormaliseerd worden. Drie
wintermaanden horen meer dan een kwart van het jaarvolume te bevatten; dat
volgt vanzelf uit de jaar-genormaliseerde fracties.
"""
from __future__ import annotations

import array
import csv
import json
import os
import struct
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

RAW_PRICES = "data/raw/anwb_stroom_uur.csv"
RAW_DYNAMIC = "data/raw/dynamic"
OUTDIR = "public/data"
NL = ZoneInfo("Europe/Amsterdam")
CATEGORY = "E1A"
AFNAMETYPE = "AMI"          # aansluiting mét invoeding: huishouden met zonnepanelen

MAGIC = b"TBAT"             # herkenningspunt in de binaire bestanden
VERSION = 1
# Header: magic(4) + versie(2) + opvulling(2) + reeksen(4) + lengte(4) = 16 bytes.
# De opvulling is er zodat de float32-data op een veelvoud van 4 begint; zonder
# dat weigert Float32Array in de browser een view op de buffer te maken.
HEADER = "<HHII"


# ── tijd ─────────────────────────────────────────────────────────────────────
def local_midnight_utc(d: date) -> datetime:
    """UTC-instant van lokale middernacht; valt nooit in het DST-gat."""
    return datetime(d.year, d.month, d.day, tzinfo=NL).astimezone(timezone.utc)


def quarters_on(d: date) -> int:
    """92 op de voorjaarsovergang, 100 op de najaarsovergang, anders 96."""
    delta = local_midnight_utc(d + timedelta(days=1)) - local_midnight_utc(d)
    return int(delta.total_seconds() // 900)


def hours_in_year(year: int) -> int:
    start = local_midnight_utc(date(year, 1, 1))
    end = local_midnight_utc(date(year + 1, 1, 1))
    return int((end - start).total_seconds() // 3600)


# ── prijzen ──────────────────────────────────────────────────────────────────
def load_prices() -> dict[int, dict[datetime, tuple[float, float]]]:
    """Uurprijzen per jaar, gesleuteld op UTC-instant. Invoer is ct/kWh."""
    per_year: dict[int, dict[datetime, tuple[float, float]]] = defaultdict(dict)
    with open(RAW_PRICES, newline="") as fh:
        for row in csv.DictReader(fh):
            ts = datetime.fromisoformat(row["datetime"]).astimezone(timezone.utc)
            # Het jaar wordt in LOKALE tijd bepaald: 31 december 23:00 UTC hoort
            # bij het volgende jaar, want lokaal is het dan al 00:00.
            jaar = ts.astimezone(NL).year
            per_year[jaar][ts] = (
                float(row["marktprijs"]) / 100.0,
                float(row["allInPrijs"]) / 100.0,
            )
    return per_year


def write_prices(year: int, data: dict[datetime, tuple[float, float]]) -> dict:
    """Schrijf een uurreeks weg en rapporteer gaten.

    Ook een onvolledig jaar wordt weggeschreven, tot het laatste uur waarvoor er
    data is. Het lopende jaar bevat juist de meest recente prijzen, en de
    frontend moet daar een venster op kunnen kiezen.
    """
    start = local_midnight_utc(date(year, 1, 1))
    vol = hours_in_year(year)
    laatste = max(data)
    n = min(vol, int((laatste - start).total_seconds() // 3600) + 1)
    markt = array.array("f", [0.0]) * n
    allin = array.array("f", [0.0]) * n

    ontbrekend = []
    vorige = None
    for i in range(n):
        ts = start + timedelta(hours=i)
        if ts in data:
            markt[i], allin[i] = data[ts]
            vorige = data[ts]
        elif vorige is not None:
            # Een enkel ontbrekend uur overbruggen we met de vorige waarde; meer
            # dan een handvol gaten maakt het jaar onbruikbaar en dat melden we.
            markt[i], allin[i] = vorige
            ontbrekend.append(ts.isoformat())
        else:
            ontbrekend.append(ts.isoformat())

    eind = start + timedelta(hours=n)
    path = os.path.join(OUTDIR, f"prices-{year}.bin")
    with open(path, "wb") as fh:
        fh.write(MAGIC)
        fh.write(struct.pack(HEADER, VERSION, 0, 2, n))
        fh.write(markt.tobytes())
        fh.write(allin.tobytes())

    # allInPrijs - marktprijs is per jaar vrijwel constant: dat is de
    # energiebelasting plus inkoopvergoeding. We leiden hem af als default voor
    # de tariefopbouw in de app, en als controle op de bron.
    verschillen = [allin[i] - markt[i] for i in range(n)]
    verschillen.sort()
    mediaan = verschillen[n // 2]
    spreiding = verschillen[-1] - verschillen[0]

    return {
        "uren": n,
        "volledig": n == vol,
        "eerste_uur_utc": start.isoformat(),
        "laatste_uur_utc": (eind - timedelta(hours=1)).isoformat(),
        "ontbrekend": len(ontbrekend),
        "eerste_ontbrekend": ontbrekend[0] if ontbrekend else None,
        "jaarconstante_eur_per_kwh": round(mediaan, 6),
        "jaarconstante_spreiding": round(spreiding, 6),
        "bytes": os.path.getsize(path),
    }


# ── profielfracties ──────────────────────────────────────────────────────────
def load_domain(path: str) -> dict[int, dict[str, dict[tuple[str, int], float]]]:
    """Fracties per jaar, per richting, gesleuteld op (kalenderdag, positie)."""
    per_year: dict[int, dict[str, dict[tuple[str, int], float]]] = defaultdict(
        lambda: defaultdict(dict))
    with open(path, newline="") as fh:
        for row in csv.DictReader(fh):
            if row["afnametype"] != AFNAMETYPE:
                continue
            kd = row["calendar_date"]
            jaar = int(kd[:4])
            per_year[jaar][row["direction"]][(kd, int(row["pos"]))] = float(row["qnt"])
    return per_year


def write_profile(
    gebied: str,
    year: int,
    reeksen: dict[str, dict[tuple[str, int], float]],
    factoren: dict[str, float] | None,
) -> tuple[dict, dict[str, float]] | None:
    """Normaliseer en schrijf E17 en E18 als één bestand weg.

    Een jaar wordt weggeschreven over de dagen die er werkelijk zijn, dus ook
    het aanloopjaar 2023 (DYNAMIC begint op 1 april) en het lopende jaar. Juist
    die randen bevatten de meest bruikbare data: het aanloopjaar verlengt de
    reeks en het lopende jaar is het meest actueel.

    De normalisatiefactor moet per KALENDERJAAR bepaald worden, want de fracties
    zijn zo geconstrueerd dat ze over een vol jaar op ongeveer 1 sommeren. Voor
    een onvolledig jaar kan dat niet uit de reeks zelf komen — de som is dan
    minder dan 1 omdat er dagen ontbreken, niet omdat de vorm anders is. Zulke
    jaren lenen daarom de factor van een volledig jaar. Zou je een deeljaar op
    zichzelf normaliseren, dan zou een gebruiker die apr–dec selecteert een heel
    jaarvolume toebedeeld krijgen.

    @param factoren  jaarsommen van een volledig jaar om te lenen, of None als
                     dit jaar zelf volledig is
    """
    dagen = []
    d = date(year, 1, 1)
    while d.year == year:
        dagen.append(d)
        d += timedelta(days=1)

    aanwezig = {kd for (kd, _) in reeksen.get("E17", {})}
    if not aanwezig:
        return None
    dagen = [x for x in dagen if x.isoformat() in aanwezig]

    # Alleen een aaneengesloten reeks is bruikbaar: een gat midden in het jaar
    # zou de tijdas laten verspringen zonder dat de app dat kan zien.
    eerste, laatste = dagen[0], dagen[-1]
    verwachte_dagen = (laatste - eerste).days + 1
    if len(dagen) != verwachte_dagen:
        print(f"    {gebied} {year}: {verwachte_dagen - len(dagen)} ontbrekende "
              f"dagen — overgeslagen", file=sys.stderr)
        return None

    volledig = eerste == date(year, 1, 1) and laatste == date(year, 12, 31)
    totaal = sum(quarters_on(x) for x in dagen)

    uit: dict[str, array.array] = {}
    eigen_som: dict[str, float] = {}

    for richting in ("E17", "E18"):
        bron = reeksen.get(richting, {})
        waarden = array.array("f", [0.0]) * totaal
        i = 0
        gevonden = 0
        for dag in dagen:
            kd = dag.isoformat()
            for pos in range(1, quarters_on(dag) + 1):
                v = bron.get((kd, pos))
                if v is not None:
                    waarden[i] = v
                    gevonden += 1
                i += 1
        if gevonden < totaal:
            print(f"    {gebied} {year} {richting}: {totaal - gevonden} "
                  f"ontbrekende kwartieren — overgeslagen", file=sys.stderr)
            return None
        eigen_som[richting] = float(sum(waarden))
        uit[richting] = waarden

    # Welke factor gebruiken we om op jaarsom 1 te normaliseren?
    if volledig:
        gebruikt = dict(eigen_som)
        geleend_van = None
    elif factoren:
        gebruikt = dict(factoren)
        geleend_van = "volledig jaar"
    else:
        # Geen enkel volledig jaar beschikbaar: dan is normaliseren giswerk.
        return None

    for richting in ("E17", "E18"):
        f = gebruikt[richting]
        if f <= 0:
            return None
        w = uit[richting]
        for k in range(totaal):
            w[k] = w[k] / f

    path = os.path.join(OUTDIR, f"profile-{gebied}-{year}.bin")
    with open(path, "wb") as fh:
        fh.write(MAGIC)
        fh.write(struct.pack(HEADER, VERSION, 0, 2, totaal))
        fh.write(uit["E17"].tobytes())
        fh.write(uit["E18"].tobytes())

    info = {
        "kwartieren": totaal,
        "eerste_dag": eerste.isoformat(),
        "laatste_dag": laatste.isoformat(),
        "volledig_jaar": volledig,
        "ruwe_som_E17": round(eigen_som["E17"], 6),
        "ruwe_som_E18": round(eigen_som["E18"], 6),
        "normalisatie_E17": round(gebruikt["E17"], 6),
        "normalisatie_E18": round(gebruikt["E18"], 6),
        "normalisatie_geleend": geleend_van,
        "bytes": os.path.getsize(path),
    }
    return info, eigen_som


def main() -> None:
    os.makedirs(OUTDIR, exist_ok=True)
    manifest: dict = {
        "gegenereerd": datetime.now(timezone.utc).isoformat(),
        "categorie": CATEGORY,
        "afnametype": AFNAMETYPE,
        "tijdzone": "Europe/Amsterdam",
        "legenda": "* achter een jaar betekent: geen volledig kalenderjaar, "
                   "genormaliseerd met de factor van een volledig jaar",
        "toelichting": {
            "prijzen": "EUR/kWh inclusief 21% btw, uurwaarden, UTC-instants",
            "fracties": "genormaliseerd op jaarsom 1 per kalenderjaar; een "
                        "deelperiode sommeert bewust op minder dan 1",
        },
        "prijzen": {},
        "profielen": {},
        "netgebieden": [],
    }

    print("prijzen…", file=sys.stderr)
    prices = load_prices()
    for jaar in sorted(prices):
        info = write_prices(jaar, prices[jaar])
        # Te veel aangevulde uren maakt een jaar onbetrouwbaar; een handvol
        # gaten overbruggen is prima, honderden niet.
        if info["ontbrekend"] > info["uren"] * 0.01:
            print(f"  {jaar}: {info['ontbrekend']} gaten op {info['uren']} uren "
                  f"— overgeslagen", file=sys.stderr)
            os.remove(os.path.join(OUTDIR, f"prices-{jaar}.bin"))
            continue
        manifest["prijzen"][str(jaar)] = info
        vlag = "" if info["volledig"] else "  (loopt nog)"
        print(f"  {jaar}: {info['uren']} uren, {info['ontbrekend']} aangevuld, "
              f"jaarconstante {info['jaarconstante_eur_per_kwh']:.4f} EUR/kWh{vlag}",
              file=sys.stderr)

    print("profielen…", file=sys.stderr)
    bestanden = sorted(f for f in os.listdir(RAW_DYNAMIC) if f.endswith(".csv"))
    for fn in bestanden:
        gebied = fn[:-4]
        manifest["netgebieden"].append(gebied)
        per_year = load_domain(os.path.join(RAW_DYNAMIC, fn))

        # Eerst de volledige kalenderjaren: die leveren de normalisatiefactor
        # waar de rand-jaren van lenen.
        factoren: dict[str, float] | None = None
        resultaten: dict[str, dict] = {}
        for jaar in sorted(per_year):
            uitkomst = write_profile(gebied, jaar, per_year[jaar], None)
            if uitkomst is None:
                continue
            info, eigen = uitkomst
            if info["volledig_jaar"]:
                resultaten[str(jaar)] = info
                # De meest recente volledige jaarsom is de beste referentie.
                factoren = eigen

        for jaar in sorted(per_year):
            if str(jaar) in resultaten:
                continue
            uitkomst = write_profile(gebied, jaar, per_year[jaar], factoren)
            if uitkomst is None:
                continue
            resultaten[str(jaar)] = uitkomst[0]

        if resultaten:
            manifest["profielen"][gebied] = dict(sorted(resultaten.items()))
        beschrijving = ", ".join(
            f"{j}{'' if v['volledig_jaar'] else '*'}"
            for j, v in sorted(resultaten.items()))
        print(f"  {gebied}: {beschrijving or 'geen bruikbaar jaar'}",
              file=sys.stderr)

    with open(os.path.join(OUTDIR, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)

    totaal = sum(os.path.getsize(os.path.join(OUTDIR, f))
                 for f in os.listdir(OUTDIR))
    print(f"✓ {len(os.listdir(OUTDIR))} bestanden, {totaal/1e6:.1f} MB",
          file=sys.stderr)


if __name__ == "__main__":
    main()
