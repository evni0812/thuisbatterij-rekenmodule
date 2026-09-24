#!/usr/bin/env python3
"""
Haal MFFBAS/EDSN DYNAMIC profielfracties op voor categorie E1A en schrijf ze
compact weg per netgebied en kalenderjaar.

DYNAMIC is de daadwerkelijk gerealiseerde vorm van afname (E17) en invoeding
(E18), dagelijks herberekend uit meetdata. Beschikbaar vanaf 2023-04-01 met
D+2 vertraging.

Gebruikt curl voor de HTTP-laag: de systeem-Python op deze machine mist de
CA-certificaten waardoor urllib een SSLCertVerificationError geeft.

Output: data/raw/dynamic/<netgebied>.csv met kolommen
    calendar_date, pos, afnametype, direction, qnt, quality
De tijdas wordt niet meegeschreven maar deterministisch gereconstrueerd uit
(calendar_date, pos) — zie lib/data/timeaxis.ts en scripts/build_assets.py.

Gebruik:
    fetch_dynamic.py [start] [eind] [--opnieuw N]

Dagen die al in het bestand staan worden overgeslagen. Maar DYNAMIC wordt de
eerste dagen na publicatie nog bijgesteld (D+2 is een eerste versie), dus met
--opnieuw N worden de laatste N dagen vóór het einde van de periode eerst uit
het bestand gehaald en opnieuw opgehaald.
"""
from __future__ import annotations

import csv
import json
import os
import subprocess
import sys
from datetime import date, timedelta

BASE = ("https://gateway.edsn.nl/energyvalues/profile-fractions-series/v1/"
        "profile-fractions")
UA = "energiedata-nl/1.0 (+https://mffbas.nl)"
PRODUCT = "023"
CATEGORY = "E1A"
DYNAMIC_START = date(2023, 4, 1)      # eerste dag met DYNAMIC-data
OUTDIR = "data/raw/dynamic"


def curl_json(url: str, retries: int = 4) -> dict:
    for attempt in range(retries):
        p = subprocess.run(
            ["curl", "-sS", "--fail", "--max-time", "180", "-A", UA, url],
            capture_output=True,
        )
        if p.returncode == 0:
            try:
                return json.loads(p.stdout)
            except json.JSONDecodeError as e:
                last = f"ongeldige JSON: {e}"
        else:
            last = p.stderr.decode("utf-8", "replace").strip()
        if attempt < retries - 1:
            wait = 2 ** attempt
            print(f"    [retry {attempt+1}] {last[:120]} — wacht {wait}s",
                  file=sys.stderr)
            subprocess.run(["sleep", str(wait)])
    raise SystemExit(f"❌ mislukt na {retries} pogingen: {last}")


def month_chunks(start: date, end: date):
    """Yield (chunk_start, chunk_end_exclusief) van maximaal 31 dagen."""
    cur = start
    while cur < end:
        if cur.month == 12:
            nxt = date(cur.year + 1, 1, 1)
        else:
            nxt = date(cur.year, cur.month + 1, 1)
        yield cur, min(nxt, end)
        cur = nxt


def list_domains() -> list[str]:
    peil = (date.today() - timedelta(days=4)).isoformat()
    nxt = (date.fromisoformat(peil) + timedelta(days=1)).isoformat()
    d = curl_json(f"{BASE}?startdate={peil}&enddate={nxt}"
                  f"&pftype=DYNAMIC&product={PRODUCT}")
    return sorted({s["domain_mRID"] for s in d["Detail_SeriesList"]
                   if s.get("domain_mRID")})


def existing_dates(path: str) -> set[str]:
    """Welke kalenderdagen staan al in een eerder weggeschreven bestand?"""
    if not os.path.exists(path):
        return set()
    with open(path, newline="") as fh:
        return {row["calendar_date"] for row in csv.DictReader(fh)}


def drop_dates_from(path: str, vanaf: date) -> int:
    """Haal alle dagen vanaf `vanaf` uit het bestand; geeft het aantal rijen terug."""
    if not os.path.exists(path):
        return 0
    with open(path, newline="") as fh:
        rijen = list(csv.reader(fh))
    kop, data = rijen[0], rijen[1:]
    grens = vanaf.isoformat()
    blijft = [r for r in data if r[0] < grens]
    if len(blijft) == len(data):
        return 0
    tmp = path + ".tmp"
    with open(tmp, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(kop)
        w.writerows(blijft)
    os.replace(tmp, path)
    return len(data) - len(blijft)


def fetch_domain(domain: str, start: date, end: date, opnieuw: int = 0) -> None:
    path = os.path.join(OUTDIR, f"{domain}.csv")
    if opnieuw > 0:
        weg = drop_dates_from(path, end - timedelta(days=opnieuw))
        if weg:
            print(f"    {weg} rijen van de laatste {opnieuw} dagen opnieuw ophalen",
                  file=sys.stderr)
    have = existing_dates(path)
    nieuw = not os.path.exists(path)

    with open(path, "a", newline="") as fh:
        w = csv.writer(fh)
        if nieuw:
            w.writerow(["calendar_date", "pos", "afnametype", "direction",
                        "qnt", "quality"])
        for cs, ce in month_chunks(start, end):
            # Een chunk overslaan mag alleen als élke dag erin al aanwezig is.
            dagen = {(cs + timedelta(days=i)).isoformat()
                     for i in range((ce - cs).days)}
            if dagen <= have:
                continue
            d = curl_json(f"{BASE}?startdate={cs}&enddate={ce}"
                          f"&pftype=DYNAMIC&product={PRODUCT}&domain={domain}")
            n = 0
            for s in d["Detail_SeriesList"]:
                if s["profileCategory"] != CATEGORY:
                    continue
                if s["calendar_date"] in have:
                    continue
                for p in s["PointList"]:
                    w.writerow([
                        s["calendar_date"], p["pos"],
                        s.get("determinedConsumption"), s["direction"],
                        p["qnt"], s.get("profileStatus_quality"),
                    ])
                    n += 1
            print(f"    {cs} → {ce}: {n} punten", file=sys.stderr)


def main() -> None:
    os.makedirs(OUTDIR, exist_ok=True)
    # DYNAMIC loopt D+2 achter; neem 3 dagen marge.
    end = date.today() - timedelta(days=3)
    start = DYNAMIC_START
    args = sys.argv[1:]
    opnieuw = 0
    if "--opnieuw" in args:
        i = args.index("--opnieuw")
        opnieuw = int(args[i + 1])
        del args[i:i + 2]
    if len(args) > 0:
        start = date.fromisoformat(args[0])
    if len(args) > 1:
        end = date.fromisoformat(args[1])

    domains = list_domains()
    print(f"netgebieden: {len(domains)}", file=sys.stderr)
    print(f"periode: {start} → {end} (excl.)", file=sys.stderr)

    for i, dom in enumerate(domains, 1):
        print(f"[{i}/{len(domains)}] {dom}", file=sys.stderr)
        fetch_domain(dom, start, end, opnieuw)

    print("✓ klaar", file=sys.stderr)


if __name__ == "__main__":
    main()
