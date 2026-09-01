import streamlit as st
import numpy as np
import pandas as pd
import plotly.graph_objects as go
from models.simulation import simulate_year, results_to_dataframe
from models.financial import (
    calculate_annual_costs,
    calculate_monthly_savings,
    calculate_multi_year_cashflows,
    calculate_npv,
    calculate_payback,
    calculate_irr,
    sensitivity_analysis,
)

st.title("Financiele Analyse")

cfg = st.session_state.config

# ── Run simulation ──────────────────────────────────────────────────

with st.spinner("Simulatie draait..."):
    result = simulate_year(cfg, year=0)
    costs = calculate_annual_costs(result, cfg)
    df = results_to_dataframe(result)
    monthly = calculate_monthly_savings(result, cfg)

# ── KPI Metrics ─────────────────────────────────────────────────────

st.header("Kerncijfers (Jaar 1)")

payback = calculate_payback(cfg)
irr = calculate_irr(cfg)
npv = calculate_npv(cfg)
cost_per_kwh = cfg["batterij_kosten_eur"] / (
    costs["equivalent_cycles"] * result.effective_usable_kwh * cfg["fin_analyse_jaren"]
) if costs["equivalent_cycles"] > 0 else float("inf")

col1, col2, col3, col4 = st.columns(4)
col1.metric(
    "Jaarlijkse besparing",
    f"€{costs['annual_saving']:.0f}",
    help=(
        "Het bedrag dat u per jaar bespaart op uw energierekening dankzij de thuisbatterij, "
        "vergeleken met de situatie zonder batterij. Bestaat uit besparing op netinkoop "
        "(zelfconsumptie) en opbrengst uit prijsarbitrage."
    ),
)
col2.metric(
    "Terugverdientijd",
    f"{payback:.1f} jaar" if payback else "n.v.t.",
    help=(
        "Het aantal jaren dat het duurt voordat de cumulatieve besparingen de aanschafkosten "
        "van de batterij volledig hebben terugverdiend (simpele terugverdientijd, zonder "
        "discontering)."
    ),
)
col3.metric(
    "NPV (netto contante waarde)",
    f"€{npv:.0f}",
    help=(
        "De netto contante waarde van alle toekomstige kasstromen, verdisconteerd naar "
        "vandaag, minus de investeringskosten. Een positieve NPV betekent dat de investering "
        "meer oplevert dan de gehanteerde disconteringsvoet."
    ),
)
col4.metric(
    "IRR",
    f"{irr * 100:.1f}%" if irr is not None else "n.v.t.",
    help=(
        "Het interne rendement (Internal Rate of Return) — het jaarlijkse rendement dat de "
        "batterij-investering oplevert over de volledige analyseperiode. Vergelijkbaar met "
        "een spaarrente: hoger is beter."
    ),
)

col1, col2, col3, col4 = st.columns(4)
col1.metric(
    "Zelfconsumptie",
    f"{costs['self_consumption_ratio_bat']:.0f}%",
    delta=f"+{costs['self_consumption_ratio_bat'] - costs['self_consumption_ratio_no_bat']:.0f}% t.o.v. zonder",
    help=(
        "Het percentage van de eigen zonnestroom dat direct of via de batterij zelf wordt "
        "verbruikt (en dus niet wordt teruggeleverd aan het net). Hoe hoger, hoe meer u "
        "profiteert van uw eigen opwek."
    ),
)
col2.metric(
    "Autarkie",
    f"{costs['autarky_bat']:.0f}%",
    delta=f"+{costs['autarky_bat'] - costs['autarky_no_bat']:.0f}% t.o.v. zonder",
    help=(
        "Het percentage van het totale huishoudelijk verbruik dat wordt gedekt door eigen "
        "zonneopwek en de batterij, zonder stroom van het net. 100% autarkie betekent "
        "volledig energieonafhankelijk."
    ),
)
col3.metric(
    "Cycli per jaar",
    f"{costs['equivalent_cycles']:.0f}",
    help=(
        "Het gemiddeld aantal volledige laad- en ontlaadcycli dat de batterij per jaar "
        "doorloopt. Fabrikanten garanderen de levensduur doorgaans in een maximaal aantal "
        "cycli, dus meer cycli versnellen de slijtage."
    ),
)
col4.metric(
    "Kosten per kWh opgeslagen",
    f"€{cost_per_kwh:.3f}",
    help=(
        "De investeringskosten gedeeld door de totaal verwachte hoeveelheid opgeslagen "
        "energie over de volledige levensduur (cycli × bruikbare capaciteit × jaren). "
        "Geeft de werkelijke kostprijs per kWh opslag weer."
    ),
)

st.divider()

# ── 1. Daily Profile Example ───────────────────────────────────────

st.header("Dagprofiel")

day_options = {
    "Zomerdag (21 juni)": 171,
    "Winterdag (21 december)": 354,
    "Lentedag (21 maart)": 79,
    "Herfstdag (21 september)": 263,
}
selected_day = st.selectbox("Kies een dag", list(day_options.keys()))
day_num = day_options[selected_day]

start_h = day_num * 24
end_h = start_h + 24
hours = list(range(24))
day_df = df.iloc[start_h:end_h]

# Precompute fixed axis ranges across ALL four example days so charts stay
# comparable when switching between days.
all_days_df = pd.concat([df.iloc[d * 24:(d + 1) * 24] for d in day_options.values()])

# Grafiek 1 (energiestromen): max of solar, grid_import, and (negative) grid_export
stromen_max = max(
    all_days_df["solar_kwh"].max(),
    all_days_df["grid_import_bat_kwh"].max(),
    all_days_df["consumption_kwh"].max(),
) * 1.15
stromen_min = -all_days_df["grid_export_bat_kwh"].max() * 1.15

# Grafiek 2 (batterij): max of SoC, charge bars (up), discharge bars (down)
bat_pos_max = max(
    all_days_df["battery_soc_kwh"].max(),
    all_days_df["charge_solar_kwh"].max() + all_days_df["charge_grid_kwh"].max(),
) * 1.15
bat_neg_max = all_days_df["battery_discharge_kwh"].max() * 1.15
bat_y_range = [-(bat_neg_max), bat_pos_max]

# EPEX secondary axis: fixed across all days, tight-fit so the price line
# uses most of the chart height rather than starting from 0.
ep_min_ct = all_days_df["spot_price_eur"].min() * 100
ep_max_ct = all_days_df["spot_price_eur"].max() * 100
ep_spread = ep_max_ct - ep_min_ct
ep_axis_range = [ep_min_ct - ep_spread * 0.4, ep_max_ct + ep_spread * 0.4]

# ── Grafiek 1: Energiestromen in huis ───────────────────────────────
# Vraag: hoe wordt het huishoudverbruik elk uur gedekt?

st.subheader("Energiestromen")
st.caption("Hoe wordt het huishoudverbruik gedekt? Zon, batterij en net samen vs. de vraag.")

fig_stromen = go.Figure()

fig_stromen.add_trace(go.Bar(
    x=hours, y=day_df["solar_kwh"].values,
    name="Zonopwek", marker_color="#FFC107", opacity=0.8,
))
fig_stromen.add_trace(go.Bar(
    x=hours, y=day_df["grid_import_bat_kwh"].values,
    name="Netverbruik", marker_color="#1E88E5", opacity=0.6,
))
fig_stromen.add_trace(go.Bar(
    x=hours, y=-day_df["grid_export_bat_kwh"].values,
    name="Teruglevering", marker_color="#8E24AA", opacity=0.6,
))
fig_stromen.add_trace(go.Scatter(
    x=hours, y=day_df["consumption_kwh"].values,
    name="Verbruik", line=dict(color="#E53935", width=2.5),
))
fig_stromen.add_trace(go.Scatter(
    x=hours, y=day_df["self_cons_bat_kwh"].values,
    name="Zelfconsumptie", fill="tozeroy",
    line=dict(color="#43A047", width=1.5), fillcolor="rgba(67,160,71,0.15)",
))

fig_stromen.update_layout(
    barmode="relative",
    xaxis=dict(title="Uur van de dag", dtick=2),
    yaxis=dict(title="kWh", range=[stromen_min, stromen_max]),
    legend=dict(orientation="h", y=-0.2),
    height=380,
    margin=dict(t=20, b=80),
)
st.plotly_chart(fig_stromen, use_container_width=True)

# ── Grafiek 2: Batterijgedrag & prijssignaal ─────────────────────────
# Vraag: wanneer laadt/ontlaadt de batterij, en waarom?

st.subheader("Batterijgedrag & prijssignaal")
st.caption("Wanneer laadt/ontlaadt de batterij? De EPEX-spotprijs verklaart de beslissing.")

fig_bat = go.Figure()

fig_bat.add_trace(go.Bar(
    x=hours, y=day_df["charge_solar_kwh"].values,
    name="Laden (zon)", marker_color="#66BB6A", opacity=0.85,
    yaxis="y",
))
fig_bat.add_trace(go.Bar(
    x=hours, y=day_df["charge_grid_kwh"].values,
    name="Laden (net)", marker_color="#1E88E5", opacity=0.85,
    yaxis="y",
))
fig_bat.add_trace(go.Bar(
    x=hours, y=-day_df["battery_discharge_kwh"].values,
    name="Ontladen", marker_color="#FB8C00", opacity=0.85,
    yaxis="y",
))
fig_bat.add_trace(go.Scatter(
    x=hours, y=day_df["battery_soc_kwh"].values,
    name="SoC batterij (kWh)", line=dict(color="#00897B", width=2),
    fill="tozeroy", fillcolor="rgba(0,137,123,0.1)",
    yaxis="y",
))
fig_bat.add_trace(go.Scatter(
    x=hours, y=day_df["spot_price_eur"].values * 100,
    name="EPEX spot (ct/kWh)", line=dict(color="#7B1FA2", width=2, dash="dot"),
    yaxis="y2",
))

fig_bat.update_layout(
    barmode="relative",
    xaxis=dict(title="Uur van de dag", dtick=2),
    yaxis=dict(title="kWh", side="left", range=bat_y_range),
    yaxis2=dict(
        title="EPEX spot (ct/kWh)",
        side="right",
        overlaying="y",
        showgrid=False,
        range=ep_axis_range,
        tickformat=".1f",
    ),
    legend=dict(orientation="h", y=-0.2),
    height=380,
    margin=dict(t=20, b=80),
)
st.plotly_chart(fig_bat, use_container_width=True)

st.divider()

# ── 2. Monthly Savings ──────────────────────────────────────────────

st.header("Maandelijkse Besparing")

month_names = ["Jan", "Feb", "Mrt", "Apr", "Mei", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dec"]

fig_monthly = go.Figure()
fig_monthly.add_trace(go.Bar(
    x=month_names,
    y=monthly["besparing_zelfconsumptie"],
    name="Zelfconsumptie",
    marker_color="#43A047",
))
fig_monthly.add_trace(go.Bar(
    x=month_names,
    y=monthly["besparing_arbitrage"],
    name="Prijsarbitrage",
    marker_color="#1E88E5",
))
fig_monthly.update_layout(
    barmode="stack",
    yaxis_title="Besparing (€)",
    height=400,
    legend=dict(orientation="h", y=-0.15),
)
st.plotly_chart(fig_monthly, use_container_width=True)

col1, col2 = st.columns(2)
col1.metric("Totaal zelfconsumptie besparing", f"€{monthly['besparing_zelfconsumptie'].sum():.0f}/jaar")
col2.metric("Totaal arbitrage besparing", f"€{monthly['besparing_arbitrage'].sum():.0f}/jaar")

st.divider()

# ── 3. Cumulative Cashflow ──────────────────────────────────────────

st.header("Cumulatieve Cashflow")

with st.spinner("Meerjarige simulatie..."):
    cashflows = calculate_multi_year_cashflows(cfg)

fig_cf = go.Figure()
years = [0] + cashflows["jaar"].tolist()
cumulative = [-cfg["batterij_kosten_eur"]] + cashflows["cumulatief"].tolist()

fig_cf.add_trace(go.Scatter(
    x=years, y=cumulative,
    mode="lines+markers",
    name="Cumulatieve cashflow",
    line=dict(color="#1E88E5", width=3),
    fill="tozeroy",
    fillcolor="rgba(30, 136, 229, 0.1)",
))
fig_cf.add_hline(y=0, line_dash="dash", line_color="gray", annotation_text="Break-even")
fig_cf.update_layout(
    xaxis_title="Jaar",
    yaxis_title="Cumulatieve besparing (€)",
    height=400,
)
st.plotly_chart(fig_cf, use_container_width=True)

col1, col2, col3 = st.columns(3)
col1.metric("Investering", f"€{cfg['batterij_kosten_eur']:.0f}")
col2.metric("Totaal bespaard na analyse periode", f"€{cumulative[-1]:.0f}")
col3.metric("Gem. cycli per jaar", f"{cashflows['cycli'].mean():.0f}")

st.divider()

# ── 4. Self-consumption Comparison ──────────────────────────────────

st.header("Energiestromen Vergelijking")

col1, col2 = st.columns(2)

with col1:
    fig_sc1 = go.Figure(go.Pie(
        labels=["Zelfconsumptie", "Teruglevering"],
        values=[
            costs["self_consumption_ratio_no_bat"],
            100 - costs["self_consumption_ratio_no_bat"],
        ],
        marker_colors=["#43A047", "#8E24AA"],
        hole=0.4,
    ))
    fig_sc1.update_layout(
        title="Zonder batterij",
        height=350,
        margin=dict(t=50, b=20),
    )
    st.plotly_chart(fig_sc1, use_container_width=True)

with col2:
    fig_sc2 = go.Figure(go.Pie(
        labels=["Zelfconsumptie", "Teruglevering"],
        values=[
            costs["self_consumption_ratio_bat"],
            100 - costs["self_consumption_ratio_bat"],
        ],
        marker_colors=["#43A047", "#8E24AA"],
        hole=0.4,
    ))
    fig_sc2.update_layout(
        title="Met batterij",
        height=350,
        margin=dict(t=50, b=20),
    )
    st.plotly_chart(fig_sc2, use_container_width=True)

# Autarky comparison bars
fig_aut = go.Figure()
fig_aut.add_trace(go.Bar(
    x=["Zonder batterij", "Met batterij"],
    y=[costs["autarky_no_bat"], costs["autarky_bat"]],
    marker_color=["#BDBDBD", "#43A047"],
    text=[f"{costs['autarky_no_bat']:.0f}%", f"{costs['autarky_bat']:.0f}%"],
    textposition="outside",
))
fig_aut.update_layout(
    yaxis_title="Autarkie (%)",
    yaxis_range=[0, 100],
    height=300,
    title="Autarkie (% van verbruik uit eigen opwek)",
)
st.plotly_chart(fig_aut, use_container_width=True)

st.divider()

# ── 5. Sensitivity Analysis ────────────────────────────────────────

st.header("Gevoeligheidsanalyse")
st.caption("Impact van parameterwijzigingen op de terugverdientijd.")

with st.spinner("Gevoeligheidsanalyse berekenen..."):
    sens = sensitivity_analysis(cfg)

max_payback = cfg["fin_analyse_jaren"] + 5

fig_sens = go.Figure()
for _, row in sens.iterrows():
    low_pb = row["terugverdientijd_laag"] if row["terugverdientijd_laag"] is not None else max_payback
    base_pb = row["terugverdientijd_basis"] if row["terugverdientijd_basis"] is not None else max_payback
    high_pb = row["terugverdientijd_hoog"] if row["terugverdientijd_hoog"] is not None else max_payback

    fig_sens.add_trace(go.Bar(
        y=[row["parameter"]],
        x=[base_pb - low_pb],
        base=[low_pb],
        orientation="h",
        marker_color="#43A047",
        name=f"{row['parameter']} (gunstig)",
        showlegend=False,
        hovertemplate=f"Laag: {low_pb:.1f} jaar<extra></extra>",
    ))
    fig_sens.add_trace(go.Bar(
        y=[row["parameter"]],
        x=[high_pb - base_pb],
        base=[base_pb],
        orientation="h",
        marker_color="#E53935",
        name=f"{row['parameter']} (ongunstig)",
        showlegend=False,
        hovertemplate=f"Hoog: {high_pb:.1f} jaar<extra></extra>",
    ))

if payback:
    fig_sens.add_vline(
        x=payback, line_dash="dash", line_color="gray",
        annotation_text=f"Basis: {payback:.1f} jaar",
    )

fig_sens.update_layout(
    xaxis_title="Terugverdientijd (jaren)",
    height=400,
    barmode="stack",
    margin=dict(l=180),
)
st.plotly_chart(fig_sens, use_container_width=True)

# Show table
with st.expander("Details gevoeligheidsanalyse"):
    display_sens = sens.copy()
    for col_name in ["terugverdientijd_laag", "terugverdientijd_basis", "terugverdientijd_hoog"]:
        display_sens[col_name] = display_sens[col_name].apply(
            lambda x: f"{x:.1f} jaar" if x is not None else "n.v.t."
        )
    st.dataframe(display_sens, use_container_width=True, hide_index=True)

st.divider()

# ── Summary table ───────────────────────────────────────────────────

st.header("Samenvatting")

summary_data = {
    "": ["Zonder batterij", "Met batterij", "Verschil"],
    "Jaarkosten (€)": [
        f"€{costs['cost_no_bat']:.0f}",
        f"€{costs['cost_bat']:.0f}",
        f"€{costs['annual_saving']:.0f}",
    ],
    "Netverbruik (kWh)": [
        f"{costs['grid_import_no_bat_kwh']:.0f}",
        f"{costs['grid_import_bat_kwh']:.0f}",
        f"{costs['grid_import_no_bat_kwh'] - costs['grid_import_bat_kwh']:.0f}",
    ],
    "Teruglevering (kWh)": [
        f"{costs['grid_export_no_bat_kwh']:.0f}",
        f"{costs['grid_export_bat_kwh']:.0f}",
        f"{costs['grid_export_no_bat_kwh'] - costs['grid_export_bat_kwh']:.0f}",
    ],
    "Zelfconsumptie (%)": [
        f"{costs['self_consumption_ratio_no_bat']:.0f}%",
        f"{costs['self_consumption_ratio_bat']:.0f}%",
        f"+{costs['self_consumption_ratio_bat'] - costs['self_consumption_ratio_no_bat']:.0f}%",
    ],
    "Autarkie (%)": [
        f"{costs['autarky_no_bat']:.0f}%",
        f"{costs['autarky_bat']:.0f}%",
        f"+{costs['autarky_bat'] - costs['autarky_no_bat']:.0f}%",
    ],
}

st.dataframe(pd.DataFrame(summary_data), use_container_width=True, hide_index=True)
