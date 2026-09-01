#!/usr/bin/env python3
"""
Vul de ANWB-uurtarieven aan tot de laatst beschikbare dag.

De basisreeks komt uit ~/code/varmails_analyse (2021-01-01 t/m 2026-06-19) en
is al in UTC. Dit script hangt er de ontbrekende staart aan.

De ANWB-API geeft bij HOUR maximaal 3 dagen per request (daarboven HTTP 500) en
verdraagt geen URL-encoded kolons, dus we bouwen de URL als directe string.

Let op: de API antwoordt met een LOKALE offset (+01:00/+02:00), niet met UTC.
We converteren naar UTC zodat de reeks homogeen blijft met de bestaande data.
"""
from __future__ import annotations

import csv
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone

BASE = "https://api.anwb.nl/energy/energy-services/v2/tarieven/electricity"
UA = "energiedata-nl/1.0"
CSV_PATH = "data/raw/anwb_stroom_uur.csv"
MAX_DAGEN = 3          # harde API-limiet voor HOUR


def curl_json(url: str, retries: int = 4) -> dict:
    for attempt in range(retries):
        p = subprocess.run(
            ["curl", "-sS", "--fail", "--max-time", "120", "-A", UA, url],
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
            subprocess.run(["sleep", str(2 ** attempt)])
    raise SystemExit(f"❌ mislukt na {retries} pogingen: {last}")


def laatste_timestamp(path: str) -> datetime | None:
    if not os.path.exists(path):
        return None
    laatste = None
    with open(path, newline="") as fh:
        for row in csv.DictReader(fh):
            laatste = row["datetime"]
    if laatste is None:
        return None
    return datetime.fromisoformat(laatste).astimezone(timezone.utc)


def main() -> None:
    laatste = laatste_timestamp(CSV_PATH)
    if laatste is None:
        raise SystemExit(f"❌ {CSV_PATH} ontbreekt of is leeg")

    start = (laatste + timedelta(hours=1)).replace(minute=0, second=0,
                                                   microsecond=0)
    eind = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    print(f"aanvullen: {start.isoformat()} → {eind.isoformat()}",
          file=sys.stderr)
    if start >= eind:
        print("  niets te doen", file=sys.stderr)
        return

    gezien = set()
    rijen = []
    cur = start
    while cur < eind:
        nxt = min(cur + timedelta(days=MAX_DAGEN), eind)
        url = (f"{BASE}?startDate={cur.strftime('%Y-%m-%dT%H:%M:%S.000Z')}"
               f"&endDate={nxt.strftime('%Y-%m-%dT%H:%M:%S.000Z')}"
               f"&interval=HOUR")
        d = curl_json(url)
        for rec in d.get("data", []):
            ts = datetime.fromisoformat(rec["date"]).astimezone(timezone.utc)
            if ts < start or ts >= eind or ts in gezien:
                continue
            gezien.add(ts)
            v = rec["values"]
            rijen.append([ts.isoformat(), "electricity",
                          v["marktprijs"], v["allInPrijs"]])
        print(f"  {cur:%Y-%m-%d} → {nxt:%Y-%m-%d}: {len(d.get('data', []))} uren",
              file=sys.stderr)
        cur = nxt

    rijen.sort(key=lambda r: r[0])
    with open(CSV_PATH, "a", newline="") as fh:
        csv.writer(fh).writerows(rijen)
    print(f"✓ {len(rijen)} uren toegevoegd", file=sys.stderr)


if __name__ == "__main__":
    main()
