"""
Typische uurprofielen voor Nederland: zonopwek, huishoudelijk verbruik, en EPEX spotprijzen.
Alle profielen worden gegenereerd als numpy arrays van 8760 uur (1 jaar).
"""

import functools
import pathlib

import numpy as np

HOURS_PER_YEAR = 8760

# Sunrise/sunset approximations per month (hour of day, NL latitude ~52N)
_MONTH_SUN = {
    1:  (8.5, 16.5),
    2:  (7.5, 17.5),
    3:  (7.0, 18.5),
    4:  (6.0, 20.0),
    5:  (5.5, 21.0),
    6:  (5.0, 22.0),
    7:  (5.5, 21.5),
    8:  (6.0, 21.0),
    9:  (7.0, 19.5),
    10: (7.5, 18.5),
    11: (8.0, 17.0),
    12: (8.5, 16.5),
}

# Monthly relative irradiance (sum ~= 1.0), based on KNMI long-term averages
_MONTH_IRRADIANCE = np.array([
    0.025, 0.04, 0.075, 0.10, 0.13, 0.14,
    0.135, 0.12, 0.09, 0.06, 0.035, 0.025,
])
_MONTH_IRRADIANCE /= _MONTH_IRRADIANCE.sum()

# Days per month
_DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]


def _month_for_hour(hour_of_year: int) -> int:
    """Return 1-indexed month for a given hour of the year."""
    day = hour_of_year // 24
    cumulative = 0
    for m, days in enumerate(_DAYS_IN_MONTH, start=1):
        cumulative += days
        if day < cumulative:
            return m
    return 12


def generate_solar_profile(kwp: float, kwh_per_kwp: float, orientation_pct: float) -> np.ndarray:
    """
    Generate hourly solar production (kWh) for a full year.
    Uses a bell-curve within daylight hours scaled by monthly irradiance.
    """
    total_annual = kwp * kwh_per_kwp * (orientation_pct / 100.0)
    profile = np.zeros(HOURS_PER_YEAR)

    for h in range(HOURS_PER_YEAR):
        month = _month_for_hour(h)
        hour_of_day = h % 24
        sunrise, sunset = _MONTH_SUN[month]

        if sunrise < hour_of_day < sunset:
            midday = (sunrise + sunset) / 2.0
            half_day = (sunset - sunrise) / 2.0
            # Bell curve peaking at solar noon
            x = (hour_of_day - midday) / half_day
            profile[h] = np.cos(x * np.pi / 2.0) ** 2
        # else remains 0

    # Scale each month so that monthly totals match irradiance distribution
    hour_idx = 0
    for m_idx, days in enumerate(_DAYS_IN_MONTH):
        month_hours = days * 24
        month_slice = profile[hour_idx : hour_idx + month_hours]
        month_sum = month_slice.sum()
        if month_sum > 0:
            target = total_annual * _MONTH_IRRADIANCE[m_idx]
            profile[hour_idx : hour_idx + month_hours] = month_slice * (target / month_sum)
        hour_idx += month_hours

    return profile


# Typical hourly consumption shape (fraction of daily total)
_CONSUMPTION_SHAPE = {
    "standaard": np.array([
        0.020, 0.015, 0.012, 0.012, 0.012, 0.015,  # 0-5
        0.025, 0.055, 0.065, 0.050, 0.040, 0.035,  # 6-11
        0.040, 0.038, 0.035, 0.035, 0.042, 0.065,  # 12-17
        0.075, 0.080, 0.075, 0.060, 0.050, 0.030,  # 18-23
    ]),
    "avondpiek": np.array([
        0.018, 0.013, 0.010, 0.010, 0.010, 0.013,  # 0-5
        0.020, 0.040, 0.045, 0.035, 0.030, 0.028,  # 6-11
        0.030, 0.028, 0.025, 0.028, 0.040, 0.080,  # 12-17
        0.095, 0.100, 0.095, 0.080, 0.065, 0.040,  # 18-23
    ]),
    "thuiswerker": np.array([
        0.018, 0.013, 0.010, 0.010, 0.010, 0.015,  # 0-5
        0.025, 0.050, 0.060, 0.065, 0.065, 0.060,  # 6-11
        0.055, 0.060, 0.060, 0.055, 0.045, 0.055,  # 12-17
        0.065, 0.065, 0.055, 0.045, 0.035, 0.025,  # 18-23
    ]),
}

# Normalize each profile shape
for _key in _CONSUMPTION_SHAPE:
    _CONSUMPTION_SHAPE[_key] = _CONSUMPTION_SHAPE[_key] / _CONSUMPTION_SHAPE[_key].sum()

# ── E1B Standaardprofiel (Netbeheer Nederland 2027) ──────────────────────────

_E1B_CSV = (
    pathlib.Path(__file__).parent.parent
    / "profielen"
    / "PROGNOSE Standaardprofielen elektriciteit 2027 versie P1.00_2027_dd2025.csv"
)
_E1B_COL_A = 7   # E1B_AZI_A: afname (consumptie), huishouden ZONDER eigen opwek
# AZI = Afname Zonder Invoeding: brutoverbruiksprofiel, geen zonnepanelen inbegrepen.
# AMI = Afname Met Invoeding: nettoprofiel voor huishoudens MÉT zonnepanelen.
# Wij simuleren de eigen opwek apart, dus AZI is de correcte basis.
# AMI zou dubbelcounting veroorzaken: overdag al laag verbruik (zon inbegrepen) én
# dan onze simulatie er nog eens overheen.
_E1B_HEADER_ROWS = 7


@functools.lru_cache(maxsize=1)
def _load_e1b_hourly() -> np.ndarray:
    """
    Laad het E1B_AZI_A standaardprofiel (kwartierwaarden) en aggregeer naar
    8760 uurwaarden, genormaliseerd zodat de jaarsom gelijk is aan 1.0.
    Resultaat kan vermenigvuldigd worden met het jaarverbruik (kWh).
    AZI = Afname Zonder Invoeding: brutoverbruik zonder eigen opwek.
    """
    values: list[float] = []
    with open(_E1B_CSV, "r", encoding="utf-8-sig") as fh:
        for _ in range(_E1B_HEADER_ROWS):
            next(fh)
        for line in fh:
            if not line.strip():
                continue
            cols = line.split(";")
            try:
                values.append(float(cols[_E1B_COL_A]))
            except (IndexError, ValueError):
                pass

    arr = np.array(values, dtype=np.float64)
    n_hours = len(arr) // 4
    hourly = arr[: n_hours * 4].reshape(n_hours, 4).sum(axis=1)
    total = hourly.sum()
    if total <= 0:
        raise ValueError("E1B profiel kon niet worden geladen; controleer het CSV-bestand.")
    return hourly / total


# Monthly consumption multiplier (heating season = higher usage)
_MONTH_CONSUMPTION_FACTOR = np.array([
    1.15, 1.10, 1.05, 0.95, 0.85, 0.80,
    0.80, 0.82, 0.90, 1.00, 1.10, 1.15,
])
_MONTH_CONSUMPTION_FACTOR /= _MONTH_CONSUMPTION_FACTOR.mean()


def generate_consumption_profile(annual_kwh: float, profile_type: str = "standaard") -> np.ndarray:
    """
    Generate hourly household consumption (kWh) for a full year.

    profile_type opties:
      "standaard"     – synthetisch gemiddeld gezin
      "avondpiek"     – meer verbruik 's avonds
      "thuiswerker"   – overdag meer verbruik
      "e1b_standaard" – E1B_AZI_A standaardprofiel Netbeheer NL 2027 (aanbevolen)
                        AZI = Afname Zonder Invoeding (brutoverbruik, geen eigen opwek)
    """
    if profile_type == "e1b_standaard":
        normalized = _load_e1b_hourly()          # shape sums to 1.0, length 8760
        return normalized * annual_kwh

    shape = _CONSUMPTION_SHAPE.get(profile_type, _CONSUMPTION_SHAPE["standaard"])
    profile = np.zeros(HOURS_PER_YEAR)

    hour_idx = 0
    for m_idx, days in enumerate(_DAYS_IN_MONTH):
        daily_kwh = (annual_kwh / 365.0) * _MONTH_CONSUMPTION_FACTOR[m_idx]
        for _ in range(days):
            profile[hour_idx : hour_idx + 24] = shape * daily_kwh
            hour_idx += 24

    return profile


# Typical EPEX day-ahead hourly shape (relative to daily average)
_EPEX_HOURLY_SHAPE = np.array([
    0.70, 0.62, 0.58, 0.55, 0.58, 0.65,  # 0-5: night low
    0.80, 0.95, 1.05, 1.00, 0.90, 0.82,  # 6-11: morning ramp
    0.78, 0.75, 0.78, 0.85, 1.00, 1.25,  # 12-17: afternoon, solar dip then rise
    1.40, 1.35, 1.20, 1.05, 0.90, 0.78,  # 18-23: evening peak
])

_EPEX_MONTH_FACTOR = np.array([
    1.20, 1.10, 1.00, 0.90, 0.80, 0.75,
    0.78, 0.82, 0.95, 1.05, 1.15, 1.25,
])
_EPEX_MONTH_FACTOR /= _EPEX_MONTH_FACTOR.mean()

# Solar cannibalisation dip: applied post-rescaling (hours 09–16) so the daily
# mean correction does not neutralise the effect.
# Magnitude is proportional to monthly irradiance → strongest in Jun/Jul,
# weaker in Mar/Apr/Sep/Oct.  Calibrated to give injection-weighted EPEX ≈ 3.6 ct/kWh
# consistent with ANWB Energie 2027 price breakdown.
_SOLAR_DIP_BASE_EUR = -0.092   # base dip per dip-hour at peak-irradiance month
_SOLAR_DIP_HOURS = set(range(9, 17))   # 09:00–16:59

# Per-month dip scale factor, proportional to KNMI irradiance / peak irradiance
_SOLAR_DIP_SCALE = _MONTH_IRRADIANCE / _MONTH_IRRADIANCE.max()


def generate_price_profile(
    avg_epex: float,
    volatility_factor: float = 1.0,
) -> np.ndarray:
    """
    Generate hourly EPEX day-ahead spot prices (EUR/kWh) for a full year.
    Returns the raw spot price (excl. taxes/levies).

    Process per day:
    1. Build the daily price curve using the hourly shape and monthly average.
    2. Rescale so the daily mean exactly equals avg_epex × month_factor.
       This preserves the relative intra-day spread and the configured level.
    3. Apply the solar cannibalisation dip AFTER rescaling (hours 09–16, all months).
       The dip is proportional to monthly irradiance so it is largest in June,
       smaller in spring/autumn, and near-zero in winter.
       Post-rescaling application prevents the daily-mean correction from
       neutralising the dip, yielding realistic low/negative zomermiddag prices.

    Result: injection-weighted avg EPEX ≈ 3.6 ct/kWh (vs ~7.9 ct for consumption),
    consistent with ANWB Energie 2027 price breakdown data.
    Prices below −0.10 EUR/kWh are clipped (historic NL floor is ~−0.15 EUR/kWh).
    """
    profile = np.zeros(HOURS_PER_YEAR)

    hour_idx = 0
    for m_idx, days in enumerate(_DAYS_IN_MONTH):
        month_avg = avg_epex * _EPEX_MONTH_FACTOR[m_idx]
        dip_magnitude = _SOLAR_DIP_BASE_EUR * _SOLAR_DIP_SCALE[m_idx]

        for _ in range(days):
            day_prices = np.zeros(24)
            for hod in range(24):
                deviation = (_EPEX_HOURLY_SHAPE[hod] - 1.0) * volatility_factor
                day_prices[hod] = month_avg * (1.0 + deviation)

            # Step 2: rescale to preserve daily mean
            day_mean = day_prices.mean()
            if day_mean > 1e-6:
                day_prices = day_prices * (month_avg / day_mean)

            # Step 3: post-rescaling solar cannibalisation dip
            for hod in _SOLAR_DIP_HOURS:
                day_prices[hod] += dip_magnitude * volatility_factor

            profile[hour_idx : hour_idx + 24] = np.maximum(day_prices, -0.10)
            hour_idx += 24

    return profile


def compute_epex_weighted_averages(
    avg_epex: float,
    volatility_factor: float,
    solar_kwp: float,
    kwh_per_kwp: float,
    orientation_pct: float,
    annual_kwh: float,
    profile_type: str,
) -> dict:
    """
    Compute surplus- and deficit-weighted EPEX averages for a given configuration.

    Returns a dict with:
      inject_epex  – EPEX weighted by surplus kWh (solar cannibalisation moments).
                     Opportunity cost of storing solar instead of exporting it.
      deficit_epex – EPEX weighted by deficit kWh (actual import moments).
                     Import-EPEX component that battery discharge avoids.

    Correct waarde zelfconsumptie (battery mediated):
      waarde = (deficit_epex + opslag + EB) − (inject_epex − terugleverkosten)
    """
    prices = generate_price_profile(avg_epex, volatility_factor)
    solar = generate_solar_profile(solar_kwp, kwh_per_kwp, orientation_pct)
    consumption = generate_consumption_profile(annual_kwh, profile_type)
    net = solar - consumption

    surplus_mask = net > 0
    deficit_mask = net < 0

    inject_epex = (
        float(np.average(prices[surplus_mask], weights=net[surplus_mask]))
        if surplus_mask.any()
        else avg_epex
    )
    deficit_epex = (
        float(np.average(prices[deficit_mask], weights=-net[deficit_mask]))
        if deficit_mask.any()
        else avg_epex
    )

    return {"inject_epex": inject_epex, "deficit_epex": deficit_epex}
