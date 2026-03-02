"""
Hourly simulation engine that combines solar/consumption/price profiles with the battery model
to produce year-long results for both 'with battery' and 'without battery' scenarios.

Uses day-ahead price optimization: since EPEX day-ahead prices are known 24 hours in advance,
the battery plans its charge/discharge schedule per day to maximize value.
"""

from dataclasses import dataclass

import numpy as np
import pandas as pd

from models.battery import Battery, BatteryConfig
from models.profiles import (
    HOURS_PER_YEAR,
    generate_consumption_profile,
    generate_price_profile,
    generate_solar_profile,
)


@dataclass
class YearResult:
    hours: np.ndarray           # 0..8759
    solar: np.ndarray           # kWh per hour
    consumption: np.ndarray     # kWh per hour
    spot_price: np.ndarray      # EUR/kWh (raw EPEX)

    # Without battery
    grid_import_no_bat: np.ndarray
    grid_export_no_bat: np.ndarray
    self_consumption_no_bat: np.ndarray

    # With battery
    grid_import_bat: np.ndarray
    grid_export_bat: np.ndarray
    self_consumption_bat: np.ndarray
    battery_soc: np.ndarray     # kWh at end of each hour
    battery_charge: np.ndarray  # kWh charged per hour
    battery_discharge: np.ndarray  # kWh discharged per hour

    # Energy source tracking (for savings decomposition)
    charge_solar_stored: np.ndarray   # kWh stored from solar per hour
    charge_grid_stored: np.ndarray    # kWh stored from grid per hour
    discharge_solar_frac: np.ndarray  # fraction of discharge sourced from solar

    equivalent_cycles: float
    effective_usable_kwh: float


def _full_import_price(spot: float, cfg: dict) -> float:
    """All-in consumer price (incl. BTW) for importing 1 kWh from the grid.
    All component values (EPEX, opslag, energiebelasting) are entered incl. BTW."""
    return spot + cfg["contract_opslag_eur"] + cfg["contract_energiebelasting_eur"]


def _export_price(spot: float, cfg: dict) -> float:
    """
    Revenue per kWh exported to the grid (post-2027: raw spot minus feed-in costs).
    Can be negative when spot prices are negative — you pay the grid to accept power.
    The battery optimizer avoids exporting during negative-price hours automatically.
    """
    return spot - cfg["contract_terugleverkosten_eur"]


def _cycle_wear_cost(cfg: dict, usable: float) -> float:
    """
    Cost of battery wear per kWh *stored* (charged into the battery).

    Derivation:
      - Total energy throughput over lifetime = cycle_life × usable_kwh (kWh stored)
      - Total cost to amortise = battery_cost_eur
      - Wear per kWh stored = battery_cost / (cycle_life × usable_kwh)

    For grid charging arbitrage this wear cost must be covered by the price spread:
      profit_per_kWh_drawn = discharge_value × rte − charge_price − eff × wear_per_kwh_stored
    Break-even charge price = discharge_value × rte − eff × wear_per_kwh_stored

    Note: solar charging also incurs wear, but the spread between import and export
    price (~€0.18/kWh) is so large it stays profitable unless wear_cost > €0.10/kWh,
    which only happens for very expensive, short-lived batteries.
    """
    cycle_life = cfg.get("batterij_cycli_levensduur", 3000)
    battery_cost = cfg.get("batterij_kosten_eur", 500)
    if cycle_life > 0 and usable > 0:
        return battery_cost / (cycle_life * usable)
    return 0.0


def _plan_day(
    day_net: np.ndarray,
    day_ip: np.ndarray,
    day_ep: np.ndarray,
    usable: float,
    max_power: float,
    rte: float,
    eff: float,
    wear_cost_per_kwh: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, float]:
    """
    Plan battery actions for a 24h window using day-ahead price knowledge.

    For each hour computes the economic value of battery energy:
      - Deficit hour: discharge_value = import_price (avoids buying)
      - Surplus hour: discharge_value = export_price (sells to grid)
      - Surplus hour: charge_cost = export_price (opportunity cost of not exporting)
      - Deficit hour: charge_cost = import_price (grid purchase price)

    Grid charging break-even:
      The minimum charge price at which grid arbitrage is profitable is:
        max_charge_price = discharge_value × RTE − eff × wear_cost_per_kwh
      where:
        - discharge_value × RTE: revenue you receive per kWh drawn when charging
        - eff × wear_cost: wear cost per kWh drawn (wear is per kWh *stored* = drawn × eff)

    Intra-day cycling (discharge-to-grid then recharge from solar) break-even:
      Discharge now at export_price, recharge later at (solar) opportunity cost.
      Profitable if: export_price × RTE > refill_export_price (i.e. spread > RTE losses).
    """
    n = len(day_net)

    dv = np.where(day_net < 0, day_ip, day_ep)
    cc = np.where(day_net >= 0, day_ep, day_ip)

    # Best and worst discharge values for threshold calculation
    best_discharge_value = float(dv.max()) if n > 0 else 0.0

    # Grid charge max price = revenue from best future discharge − wear incurred
    # Drawn from grid → store eff kWh → discharge eff² = RTE kWh of value
    grid_charge_threshold = best_discharge_value * rte - eff * wear_cost_per_kwh

    # Mark ALL deficit hours as discharge targets.
    #
    # Previously we selected only the top-N most valuable hours (where N was
    # derived from ceil(usable/max_power)+1).  That created arbitrary cliffs:
    # N jumped from 2→3 when capacity crossed a power-level threshold, causing
    # discontinuous saving jumps that were model artefacts, not real effects.
    #
    # Instead, every deficit hour is a valid target — the battery *should* use
    # stored energy whenever consumption exceeds solar.  Prioritisation between
    # deficit hours is handled entirely by the deferral logic in simulate_year,
    # which now only defers to the single best future target (not the sum of
    # all of them), so having many targets no longer causes over-deferral.
    #
    # The grid-arbitrage cap (in simulate_year) separately limits how much grid
    # energy is bought, using only hours above the profitability threshold.
    is_discharge_target = np.zeros(n, dtype=bool)
    for h in range(n):
        if day_net[h] < 0:
            is_discharge_target[h] = True

    # Charge timing is now handled via a live ranking in simulate_year
    # (mirror of the discharge ranking), which re-evaluates at every surplus
    # hour based on current SoC.  This supersedes the old static
    # preferred_charge_hours set.

    return dv, cc, is_discharge_target, grid_charge_threshold


def simulate_year(cfg: dict, year: int = 0) -> YearResult:
    """
    Run a full-year hourly simulation with day-ahead price optimization.

    Per-day strategy:
    1. Pre-compute day-ahead prices and identify best charge/discharge windows.
    2. For each hour (chronologically within the day):
       a. Direct solar self-consumption always takes priority.
       b. Solar surplus: charge battery if a future hour justifies storing it.
       c. Deficit: discharge to house if this is a high-value hour; otherwise
          consider saving battery for a more expensive hour later today.
       d. Intra-day cycling: in surplus hours with high prices, discharge to
          grid and recharge from solar later.
       e. Grid charging: buy from grid in the cheapest hours if a profitable
          discharge opportunity exists later in the day.
    """
    solar = generate_solar_profile(
        cfg["zon_kwp"], cfg["zon_kwh_per_kwp"], cfg["zon_orientatie_pct"]
    )
    consumption = generate_consumption_profile(
        cfg["huis_jaarverbruik_kwh"], cfg["huis_profiel"]
    )
    spot_price = generate_price_profile(
        cfg["contract_epex_gem_eur"], cfg["contract_volatiliteit_factor"]
    )

    bat_config = BatteryConfig.from_config_dict(cfg)
    battery = Battery(bat_config, year=year)
    eff = battery.config.one_way_efficiency
    rte = eff ** 2
    usable = battery.effective_usable
    max_power = battery.config.max_power_kw
    wear_cost = _cycle_wear_cost(cfg, usable)

    # Result arrays
    grid_import_no_bat = np.zeros(HOURS_PER_YEAR)
    grid_export_no_bat = np.zeros(HOURS_PER_YEAR)
    self_consumption_no_bat = np.zeros(HOURS_PER_YEAR)

    grid_import_bat = np.zeros(HOURS_PER_YEAR)
    grid_export_bat = np.zeros(HOURS_PER_YEAR)
    self_consumption_bat = np.zeros(HOURS_PER_YEAR)
    battery_soc = np.zeros(HOURS_PER_YEAR)
    battery_charge = np.zeros(HOURS_PER_YEAR)
    battery_discharge = np.zeros(HOURS_PER_YEAR)

    solar_kwh_in_battery = 0.0
    charge_solar_stored = np.zeros(HOURS_PER_YEAR)
    charge_grid_stored = np.zeros(HOURS_PER_YEAR)
    discharge_solar_frac = np.zeros(HOURS_PER_YEAR)

    n_days = HOURS_PER_YEAR // 24

    # Pre-compute all day plans so each day can peek at the next day's prices.
    # This enables cross-day dispatch: evening hours can defer to tomorrow's
    # expensive morning hours when that yields higher value.
    day_plans: list[dict] = []
    for day in range(n_days):
        ds = day * 24
        de = ds + 24
        d_solar = solar[ds:de]
        d_cons = consumption[ds:de]
        d_spot = spot_price[ds:de]
        d_net = d_solar - d_cons
        d_ip = np.array([_full_import_price(s, cfg) for s in d_spot])
        d_ep = np.array([_export_price(s, cfg) for s in d_spot])
        d_dv, d_cc, d_targets, d_thresh = _plan_day(
            d_net, d_ip, d_ep, usable, max_power, rte, eff, wear_cost,
        )
        d_solar_surplus = sum(max(0, d_net[j]) for j in range(24))
        d_expected_discharge = sum(
            min(max_power, max(0.0, -d_net[j]))
            for j in range(24) if d_targets[j]
        )
        d_sfb = d_solar_surplus * eff >= d_expected_discharge * 0.85
        d_fmse = np.full(24, np.inf)
        for i in range(23, -1, -1):
            ep_here = d_ep[i] if d_net[i] > 0 else np.inf
            d_fmse[i] = min(ep_here, d_fmse[min(i + 1, 23)])
        day_plans.append({
            "net": d_net, "ip": d_ip, "ep": d_ep,
            "dv": d_dv, "cc": d_cc,
            "targets": d_targets, "threshold": d_thresh,
            "sfb": d_sfb, "fmse": d_fmse,
        })

    for day in range(n_days):
        ds = day * 24
        dp = day_plans[day]
        day_net = dp["net"]
        day_ip, day_ep = dp["ip"], dp["ep"]
        dv, cc = dp["dv"], dp["cc"]
        is_discharge_target = dp["targets"]
        grid_charge_threshold = dp["threshold"]
        solar_fills_battery = dp["sfb"]
        future_min_solar_ep = dp["fmse"]

        # Next-day lookahead for cross-day dispatch ranking.
        # In the evening, the battery should consider holding energy for
        # tomorrow's expensive morning hours instead of discharging at
        # mediocre late-night prices.  We include the first 12 hours of
        # tomorrow (up to noon, when solar typically takes over).
        next_day_targets: list[tuple[int, float, float]] = []
        if day + 1 < n_days:
            ndp = day_plans[day + 1]
            for j in range(12):
                if ndp["targets"][j]:
                    next_day_targets.append(
                        (24 + j, ndp["dv"][j], min(max_power, max(0.0, -ndp["net"][j])))
                    )

        for hod in range(24):
            h = ds + hod
            s = solar[h]
            c = consumption[h]
            net = day_net[hod]

            # --- Without battery (baseline) ---
            if net >= 0:
                self_consumption_no_bat[h] = c
                grid_export_no_bat[h] = net
            else:
                self_consumption_no_bat[h] = s
                grid_import_no_bat[h] = -net

            # --- With battery (day-ahead optimized) ---
            soc = battery.state.soc_kwh
            sf = min(1.0, solar_kwh_in_battery / soc) if soc > 0.01 else 0.0

            if net >= 0:
                # ── Surplus hour: solar covers all consumption ──
                self_consumption_bat[h] = c
                surplus = net

                # Decision 1: Intra-day cycling — discharge to grid at peak,
                # refill from cheaper solar later.
                # Profitable if: sell_now × RTE > cheapest_refill + wear_per_kwh_stored
                # (the refill is solar so its cost is the foregone export price)
                #
                # Extra guard when solar won't refill the battery today:
                # Cycling permanently depletes stored energy that could instead
                # avoid an import in a future deficit hour.  In that case, also
                # require the cycling value to beat the best remaining
                # deficit-hour avoidance value (× RTE).  This prevents high-power
                # batteries from exporting cheap at moderate prices when an
                # expensive evening import is still coming.
                cheapest_refill = future_min_solar_ep[min(hod + 1, 23)]
                _future_deficit_dv = max(
                    (dv[j] for j in range(hod + 1, 24) if day_net[j] < 0),
                    default=0.0,
                )
                _cycle_threshold = cheapest_refill + wear_cost
                if not solar_fills_battery:
                    _cycle_threshold = max(_cycle_threshold, _future_deficit_dv * rte)
                if (
                    soc > 0.1
                    and day_ep[hod] * rte > _cycle_threshold
                ):
                    can_discharge = min(max_power, soc * eff)
                    delivered = battery.discharge(can_discharge)
                    if delivered > 0:
                        removed = delivered / eff
                        solar_kwh_in_battery = max(0.0, solar_kwh_in_battery - removed * sf)
                        sf = min(1.0, solar_kwh_in_battery / battery.state.soc_kwh) if battery.state.soc_kwh > 0.01 else 0.0
                        discharge_solar_frac[h] = sf
                        battery_discharge[h] += delivered
                        grid_export_bat[h] += delivered

                # Decision 2: charge from solar surplus.
                #
                # Live ranking (mirrors the discharge ranking): rank all
                # remaining surplus hours by export price ascending (cheapest
                # = lowest opportunity cost first).  Allocate the available
                # battery space to the cheapest hours.  Only charge NOW if
                # this hour is in the allocation.
                #
                # This naturally handles intra-day cycling: if the battery
                # discharges mid-day and frees up space, the ranking re-
                # evaluates and picks the cheapest remaining hours to refill.
                # It also ensures the most negative export hours are always
                # used, even if the battery was full earlier.
                soc_now = battery.state.soc_kwh
                space_kwh = (usable - soc_now) / eff if soc_now < usable - 0.01 else 0.0
                should_charge = False
                if surplus > 0 and space_kwh > 0.01:
                    remaining_surplus = [
                        (j, min(max_power, day_net[j]), day_ep[j])
                        for j in range(hod, 24) if day_net[j] > 0
                    ]
                    remaining_surplus.sort(key=lambda x: x[2])
                    budget = space_kwh
                    charge_set = set()
                    for j, avail, ep_val in remaining_surplus:
                        if budget < 0.01:
                            break
                        budget -= avail
                        charge_set.add(j)
                    should_charge = hod in charge_set

                if should_charge:
                    charged = battery.charge(surplus)
                    stored = charged * eff
                    charge_solar_stored[h] = stored
                    solar_kwh_in_battery += stored
                    battery_charge[h] += stored
                    grid_export_bat[h] += surplus - charged
                else:
                    grid_export_bat[h] += surplus

            else:
                # ── Deficit hour: consumption exceeds solar ──
                #
                # Key decision: discharge from battery OR buy directly from grid?
                #
                # If the current price is BELOW the grid-charge threshold, the hour
                # is "cheap". It is then better to:
                #   • buy this hour's deficit directly from the grid, and
                #   • keep the battery full for the expensive hours ahead.
                # Discharging now AND grid-charging back in the same hour is a wash
                # cycle that wastes efficiency losses and adds needless wear.
                #
                # If the price is AT OR ABOVE the threshold, discharge from battery
                # (it is expensive to buy, so using stored energy is worthwhile).
                deficit = -net
                is_cheap_hour = (
                    day_ip[hod] < grid_charge_threshold
                    and not solar_fills_battery
                )

                # Should we discharge now, and how much?
                #
                # When solar will refill the battery today, discharge freely in
                # ALL deficit hours — there is no opportunity cost.
                #
                # Otherwise, rank all remaining deficit hours (including the
                # current one AND tomorrow morning's hours) by discharge value.
                # Greedily allocate the available stored energy to the highest-
                # value hours first.  Only discharge NOW if the current hour
                # lands in that allocation, and limit discharge to the
                # *allocated* amount so that higher-value future hours are not
                # starved by earlier, lower-value hours being processed first
                # in chronological order.
                #
                # The next-day lookahead prevents the battery from dumping
                # energy at 23:00 (e.g. 21 ct) when tomorrow 07:00 costs 25 ct.
                # Real battery systems have access to day-ahead prices by 13:00
                # the day before, so this is realistic.
                has_future_target = (
                    bool(is_discharge_target[hod + 1:].any()) if hod < 23
                    else len(next_day_targets) > 0
                )

                has_future_solar = any(day_net[j] > 0 for j in range(hod + 1, 24))

                should_discharge = False
                discharge_limit = deficit

                if solar_fills_battery and has_future_solar:
                    should_discharge = True
                elif not has_future_target:
                    should_discharge = True
                else:
                    remaining = [
                        (j, dv[j], min(max_power, max(0.0, -day_net[j])))
                        for j in range(hod, 24) if is_discharge_target[j]
                    ]
                    remaining.extend(next_day_targets)
                    remaining.sort(key=lambda x: -x[1])
                    budget = soc * eff
                    dispatch_alloc: dict[int, float] = {}
                    for j, val, demand in remaining:
                        if budget < 0.01:
                            break
                        alloc = min(demand, budget)
                        dispatch_alloc[j] = alloc
                        budget -= alloc
                    should_discharge = hod in dispatch_alloc
                    if should_discharge:
                        discharge_limit = dispatch_alloc[hod]

                discharged = 0.0
                if soc > 0.01 and not is_cheap_hour and should_discharge:
                    sf_now = min(1.0, solar_kwh_in_battery / soc) if soc > 0.01 else 0.0
                    discharged = battery.discharge(min(deficit, discharge_limit))
                    if discharged > 0:
                        removed = discharged / eff
                        solar_kwh_in_battery = max(0.0, solar_kwh_in_battery - removed * sf_now)
                        discharge_solar_frac[h] = sf_now
                        battery_discharge[h] = discharged

                self_consumption_bat[h] = s + discharged
                grid_import_bat[h] = deficit - discharged

                # Grid charging: buy cheap power for later use.
                # Only in cheap hours (price < threshold) and only when solar
                # will not fill the battery during the day anyway.
                # Because we skipped discharging above in cheap hours, there is
                # real headroom to add energy for the coming expensive period.
                # Disabled when cfg["sim_solar_only"] is True (solar self-consumption mode).
                #
                # Cap: only charge as much as the remaining target-hour deficits
                # require.  Without this cap, a large battery with high charging
                # power buys far more cheap grid energy than it can ever discharge
                # profitably, turning a profitable arbitrage into a net loss.
                grid_arb_enabled = not cfg.get("sim_solar_only", False)
                space = usable - battery.state.soc_kwh
                if grid_arb_enabled and is_cheap_hour and space > 0.1:
                    # Count profitable future deficit hours (today + tomorrow
                    # morning) to cap grid charging to what can be discharged
                    # profitably.
                    profitable_remaining = sum(
                        min(max_power, max(0.0, -day_net[j]))
                        for j in range(hod + 1, 24)
                        if is_discharge_target[j] and day_ip[j] >= grid_charge_threshold
                    )
                    for _, nd_val, nd_demand in next_day_targets:
                        if nd_val >= grid_charge_threshold:
                            profitable_remaining += nd_demand
                    headroom = max(0.0, profitable_remaining / eff - battery.state.soc_kwh)
                    charge_amount = min(headroom, space / eff, max_power * 0.5)
                    if charge_amount > 0.05:
                        actual_drawn = battery.charge(charge_amount)
                        if actual_drawn > 0:
                            stored = actual_drawn * eff
                            charge_grid_stored[h] = stored
                            battery_charge[h] += stored
                            grid_import_bat[h] += actual_drawn

            battery_soc[h] = battery.state.soc_kwh

    # Handle remaining hours if year isn't exactly 365 days
    for h in range(n_days * 24, HOURS_PER_YEAR):
        s, c = solar[h], consumption[h]
        if s >= c:
            self_consumption_no_bat[h] = c
            grid_export_no_bat[h] = s - c
            self_consumption_bat[h] = c
            grid_export_bat[h] = s - c
        else:
            self_consumption_no_bat[h] = s
            grid_import_no_bat[h] = c - s
            self_consumption_bat[h] = s
            grid_import_bat[h] = c - s

    return YearResult(
        hours=np.arange(HOURS_PER_YEAR),
        solar=solar,
        consumption=consumption,
        spot_price=spot_price,
        grid_import_no_bat=grid_import_no_bat,
        grid_export_no_bat=grid_export_no_bat,
        self_consumption_no_bat=self_consumption_no_bat,
        grid_import_bat=grid_import_bat,
        grid_export_bat=grid_export_bat,
        self_consumption_bat=self_consumption_bat,
        battery_soc=battery_soc,
        battery_charge=battery_charge,
        battery_discharge=battery_discharge,
        charge_solar_stored=charge_solar_stored,
        charge_grid_stored=charge_grid_stored,
        discharge_solar_frac=discharge_solar_frac,
        equivalent_cycles=battery.state.equivalent_cycles,
        effective_usable_kwh=battery.effective_usable,
    )


def results_to_dataframe(result: YearResult) -> pd.DataFrame:
    """Convert simulation results to a pandas DataFrame with datetime index."""
    idx = pd.date_range("2027-01-01", periods=HOURS_PER_YEAR, freq="h")
    return pd.DataFrame({
        "solar_kwh": result.solar,
        "consumption_kwh": result.consumption,
        "spot_price_eur": result.spot_price,
        "grid_import_no_bat_kwh": result.grid_import_no_bat,
        "grid_export_no_bat_kwh": result.grid_export_no_bat,
        "self_cons_no_bat_kwh": result.self_consumption_no_bat,
        "grid_import_bat_kwh": result.grid_import_bat,
        "grid_export_bat_kwh": result.grid_export_bat,
        "self_cons_bat_kwh": result.self_consumption_bat,
        "battery_soc_kwh": result.battery_soc,
        "battery_charge_kwh": result.battery_charge,
        "battery_discharge_kwh": result.battery_discharge,
        "charge_solar_kwh": result.charge_solar_stored,
        "charge_grid_kwh": result.charge_grid_stored,
    }, index=idx)
