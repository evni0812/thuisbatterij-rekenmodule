import streamlit as st

st.title("Batterij Configuratie")
st.markdown(
    "Stel de technische en financiele parameters in voor je thuisbatterij-simulatie. "
    "Wijzigingen worden direct overgenomen in de financiele analyse."
)

cfg = st.session_state.config


def _update(key):
    """Sync widget value back to config dict."""
    st.session_state.config[key] = st.session_state[f"_w_{key}"]


# ── Batterij Technisch ──────────────────────────────────────────────

st.header("Batterij Technisch")
col1, col2 = st.columns(2)

with col1:
    st.number_input(
        "Capaciteit (kWh)",
        min_value=1.0, max_value=100.0, step=0.5,
        value=cfg["batterij_capaciteit_kwh"],
        key="_w_batterij_capaciteit_kwh",
        on_change=_update, args=("batterij_capaciteit_kwh",),
        help="Totale nominale capaciteit van de batterij.",
    )
    st.number_input(
        "Max laad/ontlaadvermogen (kW)",
        min_value=0.5, max_value=25.0, step=0.1,
        value=cfg["batterij_max_power_kw"],
        key="_w_batterij_max_power_kw",
        on_change=_update, args=("batterij_max_power_kw",),
        help="Maximaal vermogen waarmee de batterij kan laden of ontladen.",
    )
    st.number_input(
        "Levensduur (cycli)",
        min_value=1000, max_value=20000, step=500,
        value=cfg["batterij_cycli_levensduur"],
        key="_w_batterij_cycli_levensduur",
        on_change=_update, args=("batterij_cycli_levensduur",),
        help="Aantal volledige laadcycli voordat capaciteit onder 80% zakt.",
    )
    st.number_input(
        "Aanschafkosten (€)",
        min_value=500.0, max_value=50000.0, step=100.0,
        value=cfg["batterij_kosten_eur"],
        key="_w_batterij_kosten_eur",
        on_change=_update, args=("batterij_kosten_eur",),
        help="Totale kosten inclusief installatie.",
    )

with col2:
    st.number_input(
        "Bruikbare capaciteit / DoD (%)",
        min_value=50.0, max_value=100.0, step=1.0,
        value=cfg["batterij_dod_pct"],
        key="_w_batterij_dod_pct",
        on_change=_update, args=("batterij_dod_pct",),
        help="Depth of Discharge. LFP batterijen: 90-100%.",
    )
    st.number_input(
        "Round-trip efficientie (%)",
        min_value=70.0, max_value=100.0, step=0.5,
        value=cfg["batterij_efficiency_pct"],
        key="_w_batterij_efficiency_pct",
        on_change=_update, args=("batterij_efficiency_pct",),
        help="Percentage energie dat na laden+ontladen overblijft.",
    )
    st.number_input(
        "Degradatie per jaar (%)",
        min_value=0.0, max_value=5.0, step=0.1,
        value=cfg["batterij_degradatie_pct_jaar"],
        key="_w_batterij_degradatie_pct_jaar",
        on_change=_update, args=("batterij_degradatie_pct_jaar",),
        help="Jaarlijkse afname van de bruikbare capaciteit.",
    )

usable = cfg["batterij_capaciteit_kwh"] * cfg["batterij_dod_pct"] / 100
st.info(f"Bruikbare capaciteit: **{usable:.1f} kWh** · "
        f"Kosten per kWh opslag: **€{cfg['batterij_kosten_eur'] / cfg['batterij_capaciteit_kwh']:.0f}/kWh**")


# ── Zonnepanelen ────────────────────────────────────────────────────

st.header("Zonnepanelen")
col1, col2 = st.columns(2)

with col1:
    st.number_input(
        "Geinstalleerd vermogen (kWp)",
        min_value=0.0, max_value=50.0, step=0.5,
        value=cfg["zon_kwp"],
        key="_w_zon_kwp",
        on_change=_update, args=("zon_kwp",),
        help="Totaal piekvermogen van je zonnepanelen.",
    )
    st.number_input(
        "Orientatie-factor (%)",
        min_value=50.0, max_value=120.0, step=1.0,
        value=cfg["zon_orientatie_pct"],
        key="_w_zon_orientatie_pct",
        on_change=_update, args=("zon_orientatie_pct",),
        help="100% = zuiden. Oost/west ≈ 85-90%.",
    )

with col2:
    st.number_input(
        "Jaaropbrengst per kWp (kWh)",
        min_value=500.0, max_value=1400.0, step=10.0,
        value=cfg["zon_kwh_per_kwp"],
        key="_w_zon_kwh_per_kwp",
        on_change=_update, args=("zon_kwh_per_kwp",),
        help="Gemiddeld in Nederland: 850-950 kWh/kWp.",
    )

annual_solar = cfg["zon_kwp"] * cfg["zon_kwh_per_kwp"] * cfg["zon_orientatie_pct"] / 100
st.info(f"Verwachte jaaropbrengst: **{annual_solar:.0f} kWh**")


# ── Huishouden ──────────────────────────────────────────────────────

st.header("Huishouden")
col1, col2 = st.columns(2)

with col1:
    st.number_input(
        "Jaarverbruik (kWh)",
        min_value=500.0, max_value=20000.0, step=100.0,
        value=cfg["huis_jaarverbruik_kwh"],
        key="_w_huis_jaarverbruik_kwh",
        on_change=_update, args=("huis_jaarverbruik_kwh",),
        help="Totaal jaarlijks elektriciteitsverbruik van het huishouden.",
    )

with col2:
    profile_options = ["e1b_standaard", "standaard", "avondpiek", "thuiswerker"]
    profile_labels = {
        "e1b_standaard": "E1B Standaardprofiel 2027 (Netbeheer NL) ★",
        "standaard":     "Synthetisch – gemiddeld gezin",
        "avondpiek":     "Synthetisch – avondpiek",
        "thuiswerker":   "Synthetisch – thuiswerker",
    }
    current_idx = profile_options.index(cfg["huis_profiel"]) if cfg["huis_profiel"] in profile_options else 0
    st.selectbox(
        "Verbruiksprofiel",
        profile_options,
        index=current_idx,
        format_func=lambda k: profile_labels[k],
        key="_w_huis_profiel",
        on_change=_update, args=("huis_profiel",),
        help=(
            "E1B Standaardprofiel: officieel Netbeheer NL 2027 profiel voor een gemiddeld "
            "huishouden (AMI, slimmemeter). Meest nauwkeurig. "
            "Synthetische profielen zijn benaderingen."
        ),
    )


# ── Dynamisch Energiecontract ───────────────────────────────────────

st.header("Dynamisch Energiecontract (2027+)")
st.caption("Alle tarieven invullen inclusief BTW. Na afschaffing salderingsregeling: terugleververgoeding = kale EPEX spotprijs (incl. BTW) minus terugleverkosten.")

col1, col2 = st.columns(2)

with col1:
    st.number_input(
        "Gem. EPEX spotprijs, incl. BTW (€/kWh)",
        min_value=0.01, max_value=0.50, step=0.005, format="%.4f",
        value=cfg["contract_epex_gem_eur"],
        key="_w_contract_epex_gem_eur",
        on_change=_update, args=("contract_epex_gem_eur",),
        help=(
            "Gewogen gemiddelde EPEX day-ahead prijs voor afname-uren, incl. BTW. "
            "ANWB Energie 2027-prognose: €0,07932/kWh. "
            "Let op: door het solar-cannibalisation effect (zomermiddag = veel zon → lage prijs) "
            "is de gemiddelde terugleverprijs aanzienlijk lager (~3,6 ct/kWh). "
            "Het model rekent dit automatisch door in het uurprofiel."
        ),
    )
    st.number_input(
        "Energiebelasting, incl. BTW (€/kWh)",
        min_value=0.0, max_value=0.30, step=0.001, format="%.5f",
        value=cfg["contract_energiebelasting_eur"],
        key="_w_contract_energiebelasting_eur",
        on_change=_update, args=("contract_energiebelasting_eur",),
        help="Energiebelasting per kWh, incl. BTW. ANWB 2027-prognose: €0,11085/kWh.",
    )
    st.number_input(
        "Terugleverkosten (€/kWh)",
        min_value=0.0, max_value=0.10, step=0.001, format="%.3f",
        value=cfg["contract_terugleverkosten_eur"],
        key="_w_contract_terugleverkosten_eur",
        on_change=_update, args=("contract_terugleverkosten_eur",),
        help=(
            "Kosten die de leverancier in rekening brengt voor teruglevering. "
            "ANWB Energie 2027: €0,00/kWh (geen vaste terugleverkosten; "
            "je krijgt de kale EPEX-spotprijs van dat uur)."
        ),
    )

with col2:
    st.number_input(
        "Leverancier opslag, incl. BTW (€/kWh)",
        min_value=0.0, max_value=0.10, step=0.001, format="%.3f",
        value=cfg["contract_opslag_eur"],
        key="_w_contract_opslag_eur",
        on_change=_update, args=("contract_opslag_eur",),
        help="Opslag/marge van de energieleverancier bovenop EPEX, incl. BTW. ANWB 2027-prognose: €0,018/kWh.",
    )
    st.number_input(
        "Prijsvolatiliteit factor",
        min_value=0.1, max_value=3.0, step=0.1,
        value=cfg["contract_volatiliteit_factor"],
        key="_w_contract_volatiliteit_factor",
        on_change=_update, args=("contract_volatiliteit_factor",),
        help="Schaalfactor voor de dag/nacht prijsspreiding. 1.0 = normaal, >1 = meer volatiel.",
    )

# Show derived all-in price and solar cannibalisation context
all_in = cfg["contract_epex_gem_eur"] + cfg["contract_opslag_eur"] + cfg["contract_energiebelasting_eur"]

# ANWB-calibrated injection-weighted EPEX (from solar cannibalisation model)
_ANWB_INJECT_EPEX = 0.03642  # weighted avg at injection hours, incl. BTW
feed_in_inject = max(_ANWB_INJECT_EPEX - cfg["contract_terugleverkosten_eur"], 0)

st.info(
    f"Gemiddelde all-in inkoopprijs (incl. BTW): **€{all_in:.4f}/kWh** &nbsp;·&nbsp; "
    f"Gem. EPEX op injectie-uren (solar cannibalisation): **{feed_in_inject*100:.2f} ct/kWh** &nbsp;·&nbsp; "
    f"Waarde zelfconsumptie: **€{all_in - feed_in_inject:.4f}/kWh**\n\n"
    f"*Toelichting: door solar cannibalisation is de EPEX op het moment dat jij injecteert "
    f"(zomermiddag) gemiddeld ~{_ANWB_INJECT_EPEX*100:.1f} ct/kWh — veel lager dan het jaargemiddelde "
    f"van {cfg['contract_epex_gem_eur']*100:.2f} ct/kWh. "
    f"Elke kWh zelfgeconsumeerd (via batterij) is daardoor "
    f"€{(all_in - feed_in_inject):.3f}/kWh waard. "
    f"Het model berekent dit effect uurlijks via het synthetische EPEX-profiel.*"
)


# ── Financiele Parameters ───────────────────────────────────────────

st.header("Financiele Parameters")
col1, col2, col3 = st.columns(3)

with col1:
    st.number_input(
        "Analyse periode (jaren)",
        min_value=1, max_value=30, step=1,
        value=cfg["fin_analyse_jaren"],
        key="_w_fin_analyse_jaren",
        on_change=_update, args=("fin_analyse_jaren",),
    )

with col2:
    st.number_input(
        "Jaarlijkse prijsstijging (%)",
        min_value=0.0, max_value=10.0, step=0.5,
        value=cfg["fin_prijsstijging_pct"],
        key="_w_fin_prijsstijging_pct",
        on_change=_update, args=("fin_prijsstijging_pct",),
        help="Verwachte jaarlijkse stijging van energieprijzen en belastingen.",
    )

with col3:
    st.number_input(
        "Discontovoet (%)",
        min_value=0.0, max_value=15.0, step=0.5,
        value=cfg["fin_discontovoet_pct"],
        key="_w_fin_discontovoet_pct",
        on_change=_update, args=("fin_discontovoet_pct",),
        help="Rendement dat je elders op je geld had kunnen behalen.",
    )
