"""
Optimale batterijconfiguratie: welke capaciteit en welk vermogen past het best
bij dit huishouden en deze zonne-installatie?

De analyse varieert capaciteit (0,5–15 kWh) over vijf standaard vermogensniveaus
en toont hoeveel jaarlijkse besparing elke combinatie oplevert — zonder rekening te
houden met de aanschafprijs van de batterij.
"""

import json

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from models.financial import calculate_annual_costs
from models.simulation import simulate_year

st.title("Optimale Batterijconfiguratie")
st.markdown(
    "Welke capaciteit en welk vermogen halen het meeste uit jouw installatie? "
    "De simulatie combineert zonopslag én dag-nacht arbitrage — precies zoals de "
    "financiële analyse. Batterijkosten worden buiten beschouwing gelaten: "
    "alleen de jaarlijkse besparing en zelfconsumptie tellen."
)

cfg = st.session_state.config

# ── Grid-definitie ────────────────────────────────────────────────────────────

POWER_LEVELS_KW = [0.8, 2.4, 3.6, 5.0, 8.0]
POWER_LABELS = {0.8: "800 W", 2.4: "2,4 kW", 3.6: "3,6 kW", 5.0: "5,0 kW", 8.0: "8,0 kW"}
CAPACITY_LEVELS_KWH = [0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 6.0, 8.0, 10.0, 12.0, 15.0,20.0]

COLORS = {
    0.8: "#1f77b4",
    2.4: "#ff7f0e",
    3.6: "#2ca02c",
    5.0: "#d62728",
    8.0: "#9467bd",
}

# ── Instellingen ──────────────────────────────────────────────────────────────

with st.expander("Instellingen", expanded=False):
    st.caption(
        "Zonprofiel, verbruiksprofiel en tarieven worden overgenomen uit de Configuratie-pagina. "
        "Hier stel je in welke vermogensniveaus worden meegenomen en tot welke capaciteit."
    )
    col1, col2 = st.columns(2)
    with col1:
        selected_powers = st.multiselect(
            "Vermogensniveaus",
            options=POWER_LEVELS_KW,
            default=POWER_LEVELS_KW,
            format_func=lambda x: POWER_LABELS[x],
        )
    with col2:
        max_cap = st.slider("Maximale capaciteit (kWh)", 5.0, 20.0, 15.0, step=1.0)
        marginal_threshold = st.slider(
            "Drempel marginaal rendement (€/kWh)",
            5.0, 30.0, 15.0, step=1.0,
            help=(
                "Onder deze waarde (€ extra besparing per extra kWh capaciteit) "
                "telt het model de capaciteit als 'niet meer winstgevend'. "
                "De aanbevolen capaciteit stopt bij dit punt."
            ),
        )

if not selected_powers:
    st.warning("Selecteer minimaal één vermogensniveau.")
    st.stop()

cap_levels = [c for c in CAPACITY_LEVELS_KWH if c <= max_cap]

# ── Simulaties ────────────────────────────────────────────────────────────────

@st.cache_data(show_spinner=False)
def run_grid(
    cfg_json: str,
    powers: tuple,
    caps: tuple,
) -> pd.DataFrame:
    """Run all power × capacity simulations and return results DataFrame."""
    base_cfg = json.loads(cfg_json)
    records = []

    # Baseline: without battery
    base_result = simulate_year(base_cfg)
    base_costs = calculate_annual_costs(base_result, base_cfg)
    total_solar = base_result.solar.sum()
    total_consumption = base_result.consumption.sum()
    base_cost_no_bat = base_costs["cost_no_bat"]

    for power in powers:
        for cap in caps:
            c = base_cfg.copy()
            c["batterij_max_power_kw"] = power
            c["batterij_capaciteit_kwh"] = cap
            c["batterij_dod_pct"] = 90.0
            c["batterij_efficiency_pct"] = 85.0
            c["batterij_kosten_eur"] = 1.0     # irrelevant for this analysis
            c["batterij_cycli_levensduur"] = 6000
            c["batterij_degradatie_pct_jaar"] = 0.0   # no degradation

            result = simulate_year(c)
            costs = calculate_annual_costs(result, c)

            # Solar self-consumption = only energy that ultimately came from panels.
            # Grid-charged battery energy (arbitrage) is NOT solar self-consumption.
            # charge_grid_stored is energy *stored* in the battery from the grid.
            # When discharged it delivers charge_grid_stored × eff kWh to the house,
            # which is the portion to subtract from self_consumption_bat.
            eff_val = cfg.get("batterij_efficiency_pct", 85.0) / 100.0
            solar_sc = result.self_consumption_bat.sum() - result.charge_grid_stored.sum() * eff_val
            records.append({
                "power_kw": power,
                "capacity_kwh": cap,
                "annual_saving_eur": costs["annual_saving"],
                "self_consumption_ratio": solar_sc / total_solar if total_solar > 0 else 0.0,
                "autarky_ratio": solar_sc / total_consumption if total_consumption > 0 else 0.0,
                "import_kwh": costs["grid_import_bat_kwh"],
                "export_kwh": costs["grid_export_bat_kwh"],
                "cycles": result.equivalent_cycles,
            })

    return pd.DataFrame(records), base_cost_no_bat, total_solar, total_consumption


with st.spinner("Simulaties uitvoeren…"):
    df, base_cost_no_bat, total_solar, total_consumption = run_grid(
        json.dumps(cfg, sort_keys=True),
        tuple(sorted(selected_powers)),
        tuple(cap_levels),
    )

df_sel = df[df["power_kw"].isin(selected_powers)]

# ── Optimale capaciteit per vermogen ─────────────────────────────────────────

def find_optimal_capacity(group: pd.DataFrame, threshold: float) -> float:
    """
    Find the capacity at which marginal saving drops below `threshold` €/kWh.
    Returns the last capacity where it is still above threshold.
    """
    group = group.sort_values("capacity_kwh").reset_index(drop=True)
    for i in range(1, len(group)):
        delta_saving = group.loc[i, "annual_saving_eur"] - group.loc[i - 1, "annual_saving_eur"]
        delta_cap = group.loc[i, "capacity_kwh"] - group.loc[i - 1, "capacity_kwh"]
        marginal = delta_saving / delta_cap if delta_cap > 0 else 0
        if marginal < threshold:
            return group.loc[i - 1, "capacity_kwh"]
    return group["capacity_kwh"].iloc[-1]


optimal = {}
for power in selected_powers:
    grp = df_sel[df_sel["power_kw"] == power]
    optimal[power] = find_optimal_capacity(grp, marginal_threshold)

# ── Grafiek 1: jaarlijkse besparing vs capaciteit ────────────────────────────

fig1 = go.Figure()

for power in sorted(selected_powers):
    grp = df_sel[df_sel["power_kw"] == power].sort_values("capacity_kwh")
    color = COLORS[power]
    label = POWER_LABELS[power]
    opt_cap = optimal[power]
    opt_row = grp[grp["capacity_kwh"] == opt_cap].iloc[0]

    fig1.add_trace(go.Scatter(
        x=grp["capacity_kwh"],
        y=grp["annual_saving_eur"],
        mode="lines+markers",
        name=label,
        line=dict(color=color, width=2),
        marker=dict(size=6),
        hovertemplate=(
            f"<b>{label}</b><br>"
            "Capaciteit: %{x:.1f} kWh<br>"
            "Besparing: €%{y:.0f}/jr<br>"
            "<extra></extra>"
        ),
    ))

    # Mark optimal point
    fig1.add_trace(go.Scatter(
        x=[opt_cap],
        y=[opt_row["annual_saving_eur"]],
        mode="markers",
        marker=dict(color=color, size=14, symbol="star", line=dict(color="white", width=1.5)),
        name=f"Optimaal {label}",
        showlegend=False,
        hovertemplate=(
            f"<b>Optimaal: {label}</b><br>"
            f"Capaciteit: {opt_cap:.1f} kWh<br>"
            f"Besparing: €{opt_row['annual_saving_eur']:.0f}/jr<br>"
            "<extra></extra>"
        ),
    ))

fig1.update_layout(
    title="Jaarlijkse besparing per vermogen en capaciteit",
    xaxis_title="Batterijcapaciteit (kWh)",
    yaxis_title="Jaarlijkse besparing (€/jr)",
    legend_title="Max. vermogen",
    hovermode="x unified",
    height=420,
    margin=dict(t=50, b=40, l=60, r=20),
    plot_bgcolor="white",
    xaxis=dict(gridcolor="#f0f0f0"),
    yaxis=dict(gridcolor="#f0f0f0"),
)

st.plotly_chart(fig1, use_container_width=True)
st.caption("⭐ Gemarkeerd punt = aanbevolen capaciteit (marginale besparing daalt onder de ingestelde drempel)")

# ── Grafiek 2: zelfconsumptieratio vs capaciteit ─────────────────────────────

fig2 = go.Figure()

for power in sorted(selected_powers):
    grp = df_sel[df_sel["power_kw"] == power].sort_values("capacity_kwh")
    color = COLORS[power]
    label = POWER_LABELS[power]
    opt_cap = optimal[power]
    opt_row = grp[grp["capacity_kwh"] == opt_cap].iloc[0]

    fig2.add_trace(go.Scatter(
        x=grp["capacity_kwh"],
        y=grp["self_consumption_ratio"] * 100,
        mode="lines+markers",
        name=label,
        line=dict(color=color, width=2),
        marker=dict(size=6),
        hovertemplate=(
            f"<b>{label}</b><br>"
            "Capaciteit: %{x:.1f} kWh<br>"
            "Zelfconsumptie: %{y:.1f}%<br>"
            "<extra></extra>"
        ),
    ))

    fig2.add_trace(go.Scatter(
        x=[opt_cap],
        y=[opt_row["self_consumption_ratio"] * 100],
        mode="markers",
        marker=dict(color=color, size=14, symbol="star", line=dict(color="white", width=1.5)),
        showlegend=False,
        hovertemplate=(
            f"<b>Optimaal: {label}</b><br>"
            f"Capaciteit: {opt_cap:.1f} kWh<br>"
            f"Zelfconsumptie: {opt_row['self_consumption_ratio']*100:.1f}%<br>"
            "<extra></extra>"
        ),
    ))

# Reference: no-battery self-consumption
no_bat_sc = df_sel.iloc[0]["import_kwh"]  # fallback
no_bat_self_cons_pct = (
    (total_solar - df[df["capacity_kwh"] == cap_levels[0]].iloc[0]["export_kwh"]) / total_solar * 100
    if total_solar > 0 else 0
)

fig2.add_hline(
    y=no_bat_self_cons_pct,
    line_dash="dot",
    line_color="gray",
    annotation_text="Zonder batterij",
    annotation_position="right",
)

fig2.update_layout(
    title="Zelfconsumptieratio per vermogen en capaciteit",
    xaxis_title="Batterijcapaciteit (kWh)",
    yaxis_title="Zelfconsumptieratio (%)",
    yaxis=dict(range=[0, 102], gridcolor="#f0f0f0"),
    legend_title="Max. vermogen",
    hovermode="x unified",
    height=380,
    margin=dict(t=50, b=40, l=60, r=20),
    plot_bgcolor="white",
    xaxis=dict(gridcolor="#f0f0f0"),
)

st.plotly_chart(fig2, use_container_width=True)
st.caption(
    "Zelfconsumptieratio = deel van de zonnestroom dat direct thuis wordt verbruikt (incl. via batterij). "
    "100% = alle geproduceerde zonnestroom gaat naar eigen verbruik. "
    "Let op: bij grote capaciteiten laadt de batterij ook 's nachts goedkoop van het net (arbitrage). "
    "Dit verhoogt de import maar kan de netto besparing wél vergroten."
)

# ── Grafiek 3: marginale besparing (elleboog zichtbaar maken) ─────────────────

st.subheader("Marginale besparing per extra kWh capaciteit")
st.caption(
    "Hoeveel extra €/jr levert elke kWh extra batterijcapaciteit op? "
    "Zodra de lijn onder de drempelwaarde zakt, loont extra capaciteit nauwelijks meer."
)

fig3 = go.Figure()

for power in sorted(selected_powers):
    grp = df_sel[df_sel["power_kw"] == power].sort_values("capacity_kwh").reset_index(drop=True)
    color = COLORS[power]
    label = POWER_LABELS[power]

    marginal_x, marginal_y = [], []
    for i in range(1, len(grp)):
        delta_s = grp.loc[i, "annual_saving_eur"] - grp.loc[i - 1, "annual_saving_eur"]
        delta_c = grp.loc[i, "capacity_kwh"] - grp.loc[i - 1, "capacity_kwh"]
        mid_cap = (grp.loc[i, "capacity_kwh"] + grp.loc[i - 1, "capacity_kwh"]) / 2
        marginal_x.append(mid_cap)
        marginal_y.append(delta_s / delta_c if delta_c > 0 else 0)

    fig3.add_trace(go.Scatter(
        x=marginal_x,
        y=marginal_y,
        mode="lines+markers",
        name=label,
        line=dict(color=color, width=2),
        marker=dict(size=7),
        hovertemplate=(
            f"<b>{label}</b><br>"
            "Capaciteit: ~%{x:.1f} kWh<br>"
            "Marginale besparing: €%{y:.1f}/kWh/jr<br>"
            "<extra></extra>"
        ),
    ))

fig3.add_hline(
    y=marginal_threshold,
    line_dash="dash",
    line_color="#e74c3c",
    annotation_text=f"Drempel €{marginal_threshold:.0f}/kWh/jr",
    annotation_position="right",
    annotation_font_color="#e74c3c",
)

fig3.update_layout(
    xaxis_title="Batterijcapaciteit (kWh)",
    yaxis_title="Marginale besparing (€/kWh/jr)",
    yaxis=dict(rangemode="tozero", gridcolor="#f0f0f0"),
    legend_title="Max. vermogen",
    height=340,
    hovermode="x unified",
    margin=dict(t=20, b=40, l=60, r=80),
    plot_bgcolor="white",
    xaxis=dict(gridcolor="#f0f0f0"),
)

st.plotly_chart(fig3, use_container_width=True)

# ── Aanbevelingstabel ─────────────────────────────────────────────────────────

st.subheader("Aanbeveling per vermogensniveau")

rows = []
for power in sorted(selected_powers):
    opt_cap = optimal[power]
    grp = df_sel[df_sel["power_kw"] == power]
    opt_row = grp[grp["capacity_kwh"] == opt_cap].iloc[0]
    max_saving = grp["annual_saving_eur"].max()
    opt_saving = opt_row["annual_saving_eur"]
    pct_of_max = opt_saving / max_saving * 100 if max_saving > 0 else 0

    # Charge hours to fill optimal capacity
    charge_hours = opt_cap * 0.9 / power

    rows.append({
        "Vermogen": POWER_LABELS[power],
        "Opt. capaciteit": f"{opt_cap:.1f} kWh",
        "Laadtijd (vol)": f"{charge_hours:.1f} uur",
        "Besparing/jr": f"€{opt_saving:.0f}",
        "% van max mogelijk": f"{pct_of_max:.0f}%",
        "Zelfconsumptie": f"{opt_row['self_consumption_ratio']*100:.0f}%",
        "Cycli/jr": f"{opt_row['cycles']:.0f}",
    })

tbl = pd.DataFrame(rows)
st.dataframe(tbl, use_container_width=True, hide_index=True)

st.caption(
    f"**Huidige configuratie:** {cfg['zon_kwp']:.1f} kWp · "
    f"{cfg['huis_jaarverbruik_kwh']:.0f} kWh/jr verbruik · "
    f"Zon {cfg['zon_kwh_per_kwp']:.0f} kWh/kWp"
)
