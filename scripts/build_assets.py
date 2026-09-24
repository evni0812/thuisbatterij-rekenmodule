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

── Bestandsformaat ─────────────────────────────────────────────────────────
Elke .bin is een header van 16 bytes plus float32-reeksen, altijd little-
endian, ongeacht de machine die bouwt. In het manifest staat per bestand de
sha256, zodat de app een half of verkeerd gecachet bestand kan herkennen.

── Welke jaren ─────────────────────────────────────────────────────────────
Prijzen worden vanaf EERSTE_JAAR uitgeleverd: de profielen beginnen op
2023-04-01, en eerdere prijsjaren gebruikt niets. Ze zijn bovendien niet te
vertrouwen: in 2021 en 2022 zit een heffing die lager is dan wat er gold, en
in de tweede helft van 2022 nog 21% btw terwijl het 9% was. Profielen worden
afgekapt op de laatste dag waarvoor er een volledige dag prijzen is, zodat
elk profielkwartier een prijs heeft; die dag staat in het manifest.

── Afronding van de ANWB-prijzen ───────────────────────────────────────────
Sinds 20 juni 2026 geeft de ANWB-API marktprijs en allInPrijs op hele centen.
Dat is een eigenschap van de bron, geen wijziging in het tarief: allInPrijs −
marktprijs springt daardoor tussen 12 en 13 cent rond de echte heffing van
12,885 cent. De build meet per jaar welk deel van de uren op hele centen
staat (`aandeel_hele_centen`) en waarschuwt boven HELE_CENTEN_WAARSCHUWING. De
jaarconstante (de heffing van nu) wordt genomen over de uren zonder
afronding, zolang die er genoeg zijn.
"""
from __future__ import annotations

import array
import csv
import hashlib
import json
import math
import os
import struct
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

# De ruwe data staat standaard in data/raw/ van de werkmap; TBAT_RAW wijst
# een andere map aan (een worktree zonder eigen kopie van de gitignored data).
RAW = os.environ.get("TBAT_RAW", "data/raw")
RAW_PRICES = os.path.join(RAW, "anwb_stroom_uur.csv")
# Emissiefactor van de Nederlandse elektriciteitsmix per uur (NED.nl, type 27),
# opgehaald door scripts/fetch_co2.py. Kolom emissionfactor_kg_per_kwh.
RAW_CO2 = os.path.join(RAW, "ned_co2_uur.csv")
RAW_DYNAMIC = os.path.join(RAW, "dynamic")
OUTDIR = "public/data"
NL = ZoneInfo("Europe/Amsterdam")
CATEGORY = "E1A"
AFNAMETYPE = "AMI"          # aansluiting mét invoeding: huishouden met zonnepanelen
# Aansluiting zónder invoeding: huishouden zonder zonnepanelen. Zelfde categorie,
# zelfde bron, eigen gemeten vorm: geen middagdip, lagere nacht. Wordt als apart
# bestand weggeschreven (profile-<gebied>-<jaar>-azi.bin) zodat het scenario
# "zonder zonnepanelen" op echte metingen rust en niet op een model.
AFNAMETYPE_ZONDER = "AZI"

MAGIC = b"TBAT"             # herkenningspunt in de binaire bestanden
VERSION = 1
# Header: magic(4) + versie(2) + opvulling(2) + reeksen(4) + lengte(4) = 16 bytes.
# De opvulling is er zodat de float32-data op een veelvoud van 4 begint; zonder
# dat weigert Float32Array in de browser een view op de buffer te maken.
HEADER = "<HHII"

# Het eerste jaar waarvoor prijzen worden uitgeleverd: dat van de eerste
# DYNAMIC-profielen (2023-04-01). Zie de docstring bovenaan.
EERSTE_JAAR = 2023

# Boven dit aandeel uren op hele centen waarschuwt de build: dan is de
# afronding van de bron niet meer te verwaarlozen. Waarschuwen, niet falen:
# de prijzen zijn nog steeds de prijzen die de ANWB rekent.
HELE_CENTEN_WAARSCHUWING = 0.10


# ── bestanden ────────────────────────────────────────────────────────────────
def float32_le(waarden) -> bytes:
    """Een reeks als float32, expliciet little-endian (ook op een big-endian bouwmachine)."""
    return struct.pack(f"<{len(waarden)}f", *waarden)


def sha256_van(path: str) -> str:
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def schrijf_bin(path: str, reeksen: list) -> dict:
    """Schrijf header plus reeksen; geef bytes en sha256 terug voor het manifest."""
    n = len(reeksen[0]) if reeksen else 0
    assert all(len(r) == n for r in reeksen), "reeksen van ongelijke lengte"
    with open(path, "wb") as fh:
        fh.write(MAGIC)
        fh.write(struct.pack(HEADER, VERSION, 0, len(reeksen), n))
        for r in reeksen:
            fh.write(float32_le(r))
    return {"bytes": os.path.getsize(path), "sha256": sha256_van(path)}


def is_hele_cent(eur: float) -> bool:
    """Staat een prijs op hele centen? Ruim genoeg voor een float32-waarde; een
    echte prijs met vijf decimalen valt daar maar zelden toevallig binnen."""
    ct = eur * 100.0
    return abs(ct - round(ct)) < 1e-4


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


# ── CO2 ──────────────────────────────────────────────────────────────────────
def load_co2() -> dict[int, dict[datetime, float]]:
    """Emissiefactor per uur in gram per kWh, gesleuteld op UTC-instant."""
    per_year: dict[int, dict[datetime, float]] = defaultdict(dict)
    if not os.path.exists(RAW_CO2):
        return per_year
    with open(RAW_CO2, newline="") as fh:
        for row in csv.DictReader(fh):
            f = row.get("emissionfactor_kg_per_kwh")
            if not f:
                continue
            ts = datetime.fromisoformat(row["validfrom_utc"]).astimezone(timezone.utc)
            per_year[ts.astimezone(NL).year][ts] = float(f) * 1000.0
    return per_year


def write_co2(year: int, data: dict[datetime, float]) -> dict:
    """Schrijf de uurreeks emissiefactoren weg (één float32-reeks, g/kWh).

    Zelfde tijdas als de prijzen: het eerste uur is lokale middernacht op
    1 januari, per uur één waarde, tot het laatste uur waarvoor er data is. Een
    los ontbrekend uur krijgt de vorige waarde; dat wordt gemeld. Zonder vorige
    waarde (het begin van de reeks) wordt het NaN, niet 0: een factor van nul
    gram zou als de schoonste stroom van het jaar tellen. De app slaat een
    NaN-kwartier over en telt het als ontbrekend.
    """
    start = local_midnight_utc(date(year, 1, 1))
    vol = hours_in_year(year)
    laatste = max(data)
    n = min(vol, int((laatste - start).total_seconds() // 3600) + 1)
    reeks = array.array("f", [math.nan]) * n
    ontbrekend = []
    vorige = None
    for i in range(n):
        ts = start + timedelta(hours=i)
        if ts in data:
            reeks[i] = data[ts]
            vorige = data[ts]
        elif vorige is not None:
            reeks[i] = vorige
            ontbrekend.append(ts.isoformat())
        else:
            ontbrekend.append(ts.isoformat())
    path = os.path.join(OUTDIR, f"co2-{year}.bin")
    bestand = schrijf_bin(path, [reeks])
    eind = start + timedelta(hours=n)
    geldig = [v for v in reeks if not math.isnan(v)]
    return {
        "uren": n,
        "volledig": n == vol,
        "eerste_uur_utc": start.isoformat(),
        "laatste_uur_utc": (eind - timedelta(hours=1)).isoformat(),
        "ontbrekend": len(ontbrekend),
        "gemiddelde_g_per_kwh": round(sum(geldig) / len(geldig), 1) if geldig else 0.0,
        **bestand,
    }


def schrijf_co2(manifest: dict) -> None:
    print("co2…", file=sys.stderr)
    co2 = load_co2()
    manifest["co2"] = {}
    manifest.setdefault("toelichting", {})["co2"] = (
        "emissiefactor van de Nederlandse elektriciteitsmix (NED.nl, type 27 "
        "ElectricityMix, opwek exclusief import), gram CO2 per kWh, uurwaarden, UTC-instants"
    )
    for jaar in sorted(co2):
        info = write_co2(jaar, co2[jaar])
        if info["ontbrekend"] > info["uren"] * 0.01:
            print(f"  {jaar}: {info['ontbrekend']} gaten op {info['uren']} uren — overgeslagen",
                  file=sys.stderr)
            os.remove(os.path.join(OUTDIR, f"co2-{jaar}.bin"))
            continue
        manifest["co2"][str(jaar)] = info
        vlag = "" if info["volledig"] else "  (loopt nog)"
        print(f"  {jaar}: {info['uren']} uren, gemiddeld {info['gemiddelde_g_per_kwh']} g/kWh{vlag}",
              file=sys.stderr)


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
    bestand = schrijf_bin(path, [markt, allin])

    # allInPrijs - marktprijs is per jaar vrijwel constant: dat is de
    # energiebelasting plus inkoopvergoeding. We leiden hem af als default voor
    # de tariefopbouw in de app, en als controle op de bron.
    #
    # Over de uren zónder afronding op hele centen, zolang dat er minstens een
    # week is: op afgeronde uren springt het verschil tussen 12 en 13 cent rond
    # de echte heffing (meestal 13), en de mediaan zou kantelen zodra de afgeronde uren in
    # de meerderheid komen (2026: 12,88 → 13,00 ct in de loop van het najaar).
    hele_centen = [is_hele_cent(markt[i]) and is_hele_cent(allin[i]) for i in range(n)]
    niet_afgerond = [i for i in range(n) if not hele_centen[i]]
    basis = niet_afgerond if len(niet_afgerond) >= 24 * 7 else range(n)
    verschillen = sorted(allin[i] - markt[i] for i in basis)
    mediaan = verschillen[len(verschillen) // 2]
    spreiding = verschillen[-1] - verschillen[0]
    aandeel = sum(hele_centen) / len(hele_centen) if hele_centen else 0.0
    # Vanaf welke dag staat elk volgend uur op hele centen? (2026: 20 juni.)
    vanaf = None
    for i in range(len(hele_centen) - 1, -1, -1):
        if not hele_centen[i]:
            break
        vanaf = i
    hele_centen_vanaf = (
        (start + timedelta(hours=vanaf)).astimezone(NL).date().isoformat()
        if vanaf is not None and aandeel > HELE_CENTEN_WAARSCHUWING else None
    )

    return {
        "uren": n,
        "volledig": n == vol,
        "eerste_uur_utc": start.isoformat(),
        "laatste_uur_utc": (eind - timedelta(hours=1)).isoformat(),
        "ontbrekend": len(ontbrekend),
        "eerste_ontbrekend": ontbrekend[0] if ontbrekend else None,
        "jaarconstante_eur_per_kwh": round(mediaan, 6),
        "jaarconstante_spreiding": round(spreiding, 6),
        "aandeel_hele_centen": round(aandeel, 4),
        "hele_centen_vanaf": hele_centen_vanaf,
        **bestand,
    }


def laatste_volledige_prijsdag(prijzen: dict[int, dict[datetime, tuple[float, float]]]) -> date:
    """De laatste lokale kalenderdag waarvoor élk uur een prijs heeft."""
    alle = set()
    for per_uur in prijzen.values():
        alle.update(per_uur)
    d = max(alle).astimezone(NL).date()
    while True:
        begin = local_midnight_utc(d)
        uren = int((local_midnight_utc(d + timedelta(days=1)) - begin).total_seconds() // 3600)
        if all(begin + timedelta(hours=h) in alle for h in range(uren)):
            return d
        d -= timedelta(days=1)


# ── profielfracties ──────────────────────────────────────────────────────────
def load_domain(
    path: str, afnametype: str = AFNAMETYPE,
) -> dict[int, dict[str, dict[tuple[str, int], float]]]:
    """Fracties per jaar, per richting, gesleuteld op (kalenderdag, positie)."""
    per_year: dict[int, dict[str, dict[tuple[str, int], float]]] = defaultdict(
        lambda: defaultdict(dict))
    with open(path, newline="") as fh:
        for row in csv.DictReader(fh):
            if row["afnametype"] != afnametype:
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
    achtervoegsel: str = "",
    tot: date | None = None,
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
    @param tot       laatste dag die mee mag: de laatste volledige prijsdag.
                     Een profielkwartier zonder prijs kan de app niet rekenen.
    """
    dagen = []
    d = date(year, 1, 1)
    while d.year == year:
        dagen.append(d)
        d += timedelta(days=1)

    aanwezig = {kd for (kd, _) in reeksen.get("E17", {})}
    if not aanwezig:
        return None
    dagen = [x for x in dagen if x.isoformat() in aanwezig and (tot is None or x <= tot)]
    if not dagen:
        return None

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

    path = os.path.join(OUTDIR, f"profile-{gebied}-{year}{achtervoegsel}.bin")
    bestand = schrijf_bin(path, [uit["E17"], uit["E18"]])

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
        **bestand,
    }
    return info, eigen_som


def schrijf_jaren(
    gebied: str,
    per_year: dict[int, dict[str, dict[tuple[str, int], float]]],
    achtervoegsel: str,
    tot: date | None = None,
) -> dict[str, dict]:
    """Schrijf alle jaren van één netgebied en afnametype; volle jaren eerst."""
    # Eerst de volledige kalenderjaren: die leveren de normalisatiefactor
    # waar de rand-jaren van lenen.
    factoren: dict[str, float] | None = None
    resultaten: dict[str, dict] = {}
    for jaar in sorted(per_year):
        uitkomst = write_profile(gebied, jaar, per_year[jaar], None, achtervoegsel, tot)
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
        uitkomst = write_profile(gebied, jaar, per_year[jaar], factoren, achtervoegsel, tot)
        if uitkomst is None:
            continue
        resultaten[str(jaar)] = uitkomst[0]
    return resultaten


def main() -> None:
    os.makedirs(OUTDIR, exist_ok=True)
    # Alleen de CO2-reeks bijwerken, in het bestaande manifest: de profielen
    # opnieuw bouwen kost minuten en verandert niets aan de CO2-data.
    if "--alleen-co2" in sys.argv:
        with open(os.path.join(OUTDIR, "manifest.json")) as fh:
            manifest = json.load(fh)
        schrijf_co2(manifest)
        with open(os.path.join(OUTDIR, "manifest.json"), "w") as fh:
            json.dump(manifest, fh, indent=2)
        return
    manifest: dict = {
        "gegenereerd": datetime.now(timezone.utc).isoformat(),
        "categorie": CATEGORY,
        "afnametype": AFNAMETYPE,
        "afnametype_zonder": AFNAMETYPE_ZONDER,
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
        # Zelfde opbouw als "profielen", voor de aansluitingen zonder invoeding.
        "profielen_zonder": {},
        "netgebieden": [],
    }

    print("prijzen…", file=sys.stderr)
    prices = {j: v for j, v in load_prices().items() if j >= EERSTE_JAAR}
    # Oude prijsbestanden van vóór EERSTE_JAAR opruimen, zodat ze niet stil
    # blijven meeliften in public/data.
    for fn in os.listdir(OUTDIR):
        if fn.startswith("prices-") and fn.endswith(".bin") and int(fn[7:11]) < EERSTE_JAAR:
            os.remove(os.path.join(OUTDIR, fn))
    tot = laatste_volledige_prijsdag(prices)
    manifest["profielen_tot"] = tot.isoformat()
    manifest["toelichting"]["profielen_tot"] = (
        "profielen zijn afgekapt op de laatste dag met een volledige dag prijzen")
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
        if info["aandeel_hele_centen"] > HELE_CENTEN_WAARSCHUWING:
            print(f"  ⚠ {jaar}: {info['aandeel_hele_centen']:.0%} van de uren op hele centen"
                  f" (vanaf {info['hele_centen_vanaf']}): de ANWB-API rondt af",
                  file=sys.stderr)

    schrijf_co2(manifest)

    print("profielen…", file=sys.stderr)
    bestanden = sorted(f for f in os.listdir(RAW_DYNAMIC) if f.endswith(".csv"))
    for fn in bestanden:
        gebied = fn[:-4]
        manifest["netgebieden"].append(gebied)
        for afnametype, sleutel, achtervoegsel in (
            (AFNAMETYPE, "profielen", ""),
            (AFNAMETYPE_ZONDER, "profielen_zonder", "-azi"),
        ):
            per_year = load_domain(os.path.join(RAW_DYNAMIC, fn), afnametype)
            resultaten = schrijf_jaren(gebied, per_year, achtervoegsel, tot)
            if resultaten:
                manifest[sleutel][gebied] = dict(sorted(resultaten.items()))
            beschrijving = ", ".join(
                f"{j}{'' if v['volledig_jaar'] else '*'}"
                for j, v in sorted(resultaten.items()))
            print(f"  {gebied} {afnametype}: {beschrijving or 'geen bruikbaar jaar'}",
                  file=sys.stderr)

    with open(os.path.join(OUTDIR, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)

    totaal = sum(os.path.getsize(os.path.join(OUTDIR, f))
                 for f in os.listdir(OUTDIR))
    print(f"✓ {len(os.listdir(OUTDIR))} bestanden, {totaal/1e6:.1f} MB",
          file=sys.stderr)


if __name__ == "__main__":
    main()
