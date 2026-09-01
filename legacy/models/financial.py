"""
Financial calculations: annual savings, NPV, IRR, payback period, and sensitivity analysis.
"""

import numpy as np
import pandas as pd

from models.simulation import YearResult, simulate_year


def _full_import_price(spot: float, cfg: dict) -> float:
    """All-in consumer price (incl. BTW) for importing 1 kWh from the grid.
    All component values (EPEX, opslag, energiebelasting) are entered incl. BTW."""
    return spot + cfg["contract_opslag_eur"] + cfg["contract_energiebelasting_eur"]


def _export_price(spot: float, cfg: dict) -> float:
    """Revenue (or cost, if negative) per kWh exported to the grid."""
    return spot - cfg["contract_terugleverkosten_eur"]


def calculate_annual_costs(result: YearResult, cfg: dict) -> dict:
    """
    Calculate total annual electricity costs for both scenarios.
    Returns a dict with cost breakdowns.
    """
    cost_no_bat = 0.0
    revenue_no_bat = 0.0
    cost_bat = 0.0
    revenue_bat = 0.0

    for h in range(len(result.hours)):
        spot = result.spot_price[h]
        import_price = _full_import_price(spot, cfg)
        export_rev = _export_price(spot, cfg)

        cost_no_bat += result.grid_import_no_bat[h] * import_price
        revenue_no_bat += result.grid_export_no_bat[h] * export_rev

        cost_bat += result.grid_import_bat[h] * import_price
        revenue_bat += result.grid_export_bat[h] * export_rev

    net_no_bat = cost_no_bat - revenue_no_bat
    net_bat = cost_bat - revenue_bat
    annual_saving = net_no_bat - net_bat

    total_consumption = result.consumption.sum()
    self_cons_no_bat = result.self_consumption_no_bat.sum()
    self_cons_bat = result.self_consumption_bat.sum()
    total_solar = result.solar.sum()

    sc_ratio_no_bat = (self_cons_no_bat / total_solar * 100) if total_solar > 0 else 0
    sc_ratio_bat = min(100.0, (self_cons_bat / total_solar * 100)) if total_solar > 0 else 0

    autarky_no_bat = (self_cons_no_bat / total_consumption * 100) if total_consumption > 0 else 0
    autarky_bat = (self_cons_bat / total_consumption * 100) if total_consumption > 0 else 0

    return {
        "cost_no_bat": net_no_bat,
        "cost_bat": net_bat,
        "annual_saving": annual_saving,
        "grid_import_no_bat_kwh": result.grid_import_no_bat.sum(),
        "grid_export_no_bat_kwh": result.grid_export_no_bat.sum(),
        "grid_import_bat_kwh": result.grid_import_bat.sum(),
        "grid_export_bat_kwh": result.grid_export_bat.sum(),
        "self_consumption_ratio_no_bat": sc_ratio_no_bat,
        "self_consumption_ratio_bat": sc_ratio_bat,
        "autarky_no_bat": autarky_no_bat,
        "autarky_bat": autarky_bat,
        "total_solar_kwh": total_solar,
        "total_consumption_kwh": total_consumption,
        "equivalent_cycles": result.equivalent_cycles,
    }


def calculate_monthly_savings(result: YearResult, cfg: dict) -> pd.DataFrame:
    """Calculate savings broken down by month."""
    idx = pd.date_range("2027-01-01", periods=len(result.hours), freq="h")
    months = idx.month

    records = []
    for m in range(1, 13):
        mask = months == m
        cost_no_bat = 0.0
        rev_no_bat = 0.0
        cost_bat = 0.0
        rev_bat = 0.0

        for h in np.where(mask)[0]:
            spot = result.spot_price[h]
            ip = _full_import_price(spot, cfg)
            ep = _export_price(spot, cfg)

            cost_no_bat += result.grid_import_no_bat[h] * ip
            rev_no_bat += result.grid_export_no_bat[h] * ep
            cost_bat += result.grid_import_bat[h] * ip
            rev_bat += result.grid_export_bat[h] * ep

        net_no = cost_no_bat - rev_no_bat
        net_bat = cost_bat - rev_bat
        total_saving = net_no - net_bat

        # Split savings by tracking energy source through the battery:
        # Self-consumption = solar→battery→house cycle (lost export + avoided import)
        # Arbitrage = grid involvement (grid charging cost, grid-sourced discharge benefit, grid export revenue)
        sc_saving = 0.0
        arb_saving = 0.0
        eff = (cfg["batterij_efficiency_pct"] / 100.0) ** 0.5

        for h in np.where(mask)[0]:
            spot = result.spot_price[h]
            ip = _full_import_price(spot, cfg)
            ep = _export_price(spot, cfg)
            net = result.solar[h] - result.consumption[h]
            sf = result.discharge_solar_frac[h]

            # Charging costs
            if result.charge_solar_stored[h] > 0:
                solar_drawn = result.charge_solar_stored[h] / eff
                sc_saving -= solar_drawn * ep

            if result.charge_grid_stored[h] > 0:
                grid_drawn = result.charge_grid_stored[h] / eff
                arb_saving -= grid_drawn * ip

            # Discharge benefits
            if result.battery_discharge[h] > 0:
                discharge = result.battery_discharge[h]
                if net < 0:
                    # Discharge to house: avoided grid import
                    sc_saving += sf * discharge * ip
                    arb_saving += (1 - sf) * discharge * ip
                else:
                    # Discharge to grid: export revenue (arbitrage)
                    arb_saving += discharge * ep

        arbitrage_saving = arb_saving

        records.append({
            "maand": m,
            "kosten_zonder_batterij": net_no,
            "kosten_met_batterij": net_bat,
            "besparing_totaal": total_saving,
            "besparing_zelfconsumptie": sc_saving,
            "besparing_arbitrage": arbitrage_saving,
        })

    return pd.DataFrame(records)


def calculate_multi_year_cashflows(cfg: dict) -> pd.DataFrame:
    """
    Calculate cashflows over the full analysis period, accounting for
    price escalation, battery degradation, and discounting.
    """
    years = cfg["fin_analyse_jaren"]
    price_escalation = 1 + cfg["fin_prijsstijging_pct"] / 100.0
    discount_rate = cfg["fin_discontovoet_pct"] / 100.0
    investment = cfg["batterij_kosten_eur"]

    records = []
    cumulative = -investment

    for y in range(years):
        escalated_cfg = cfg.copy()
        escalated_cfg["contract_epex_gem_eur"] = cfg["contract_epex_gem_eur"] * (price_escalation ** y)
        escalated_cfg["contract_energiebelasting_eur"] = cfg["contract_energiebelasting_eur"] * (price_escalation ** y)

        result = simulate_year(escalated_cfg, year=y)
        costs = calculate_annual_costs(result, escalated_cfg)
        saving = costs["annual_saving"]

        # Year y+1 cashflow arrives at end of year → discount at (1+r)^(y+1)
        discount_factor = 1 / ((1 + discount_rate) ** (y + 1))
        pv_saving = saving * discount_factor
        cumulative += saving

        records.append({
            "jaar": y + 1,
            "besparing_nominaal": saving,
            "besparing_contant": pv_saving,
            "cumulatief": cumulative,
            "cycli": costs["equivalent_cycles"],
        })

    return pd.DataFrame(records)


def calculate_npv(cfg: dict) -> float:
    """Net Present Value of the battery investment."""
    df = calculate_multi_year_cashflows(cfg)
    return df["besparing_contant"].sum() - cfg["batterij_kosten_eur"]


def calculate_payback(cfg: dict) -> float | None:
    """Simple payback period in years. Returns None if never pays back."""
    df = calculate_multi_year_cashflows(cfg)
    for _, row in df.iterrows():
        if row["cumulatief"] >= 0:
            if row["jaar"] == 1:
                return row["jaar"]
            prev = df[df["jaar"] == row["jaar"] - 1]["cumulatief"].values[0]
            fraction = -prev / (row["cumulatief"] - prev) if (row["cumulatief"] - prev) != 0 else 0
            return row["jaar"] - 1 + fraction
    return None


def calculate_irr(cfg: dict) -> float | None:
    """Internal Rate of Return via bisection method."""
    df = calculate_multi_year_cashflows(cfg)
    cashflows = [-cfg["batterij_kosten_eur"]] + df["besparing_nominaal"].tolist()

    def npv_at_rate(r):
        return sum(cf / (1 + r) ** t for t, cf in enumerate(cashflows))

    lo, hi = -0.5, 2.0
    if npv_at_rate(lo) * npv_at_rate(hi) > 0:
        return None

    for _ in range(100):
        mid = (lo + hi) / 2
        if npv_at_rate(mid) > 0:
            lo = mid
        else:
            hi = mid
        if abs(hi - lo) < 1e-6:
            break

    return (lo + hi) / 2


def sensitivity_analysis(cfg: dict) -> pd.DataFrame:
    """
    Vary key parameters one at a time and measure impact on payback period.
    Returns a DataFrame with parameter, low/high values, and payback results.
    """
    params = [
        ("batterij_kosten_eur", "Batterijkosten", 0.7, 1.3),
        ("contract_epex_gem_eur", "EPEX spotprijs", 0.5, 1.5),
        ("huis_jaarverbruik_kwh", "Jaarverbruik", 0.7, 1.3),
        ("zon_kwp", "Zonnepanelen (kWp)", 0.5, 1.5),
        ("batterij_capaciteit_kwh", "Batterij capaciteit", 0.5, 1.5),
        ("contract_volatiliteit_factor", "Prijsvolatiliteit", 0.5, 2.0),
    ]

    base_payback = calculate_payback(cfg)
    records = []

    for key, label, lo_mult, hi_mult in params:
        base_val = cfg[key]

        low_cfg = cfg.copy()
        low_cfg[key] = base_val * lo_mult
        low_payback = calculate_payback(low_cfg)

        high_cfg = cfg.copy()
        high_cfg[key] = base_val * hi_mult
        high_payback = calculate_payback(high_cfg)

        records.append({
            "parameter": label,
            "basis_waarde": base_val,
            "laag": base_val * lo_mult,
            "hoog": base_val * hi_mult,
            "terugverdientijd_laag": low_payback,
            "terugverdientijd_basis": base_payback,
            "terugverdientijd_hoog": high_payback,
        })

    return pd.DataFrame(records)
