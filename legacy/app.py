import streamlit as st
import json
import os

st.set_page_config(
    page_title="Thuisbatterij Rekenmodule",
    page_icon="🔋",
    layout="wide",
)

PROFILES_DIR = os.path.join(os.path.dirname(__file__), "data", "saved_profiles")
os.makedirs(PROFILES_DIR, exist_ok=True)

DEFAULT_CONFIG = {
    "batterij_capaciteit_kwh": 10.0,
    "batterij_dod_pct": 95.0,
    "batterij_max_power_kw": 3.6,
    "batterij_efficiency_pct": 92.0,
    "batterij_cycli_levensduur": 8000,
    "batterij_degradatie_pct_jaar": 1.5,
    "batterij_kosten_eur": 6000.0,
    "zon_kwp": 8.0,
    "zon_kwh_per_kwp": 900.0,
    "zon_orientatie_pct": 100.0,
    "huis_jaarverbruik_kwh": 3500.0,
    "huis_profiel": "e1b_standaard",
    "contract_epex_gem_eur": 0.07932,
    "contract_opslag_eur": 0.018,
    "contract_energiebelasting_eur": 0.11085,
    "contract_btw_pct": 0.0,
    "contract_terugleverkosten_eur": 0.0,
    "contract_volatiliteit_factor": 1.0,
    "fin_analyse_jaren": 15,
    "fin_prijsstijging_pct": 2.0,
    "fin_discontovoet_pct": 3.0,
}

if "config" not in st.session_state:
    st.session_state.config = DEFAULT_CONFIG.copy()


def list_saved_profiles():
    if not os.path.isdir(PROFILES_DIR):
        return []
    return sorted(
        f.replace(".json", "")
        for f in os.listdir(PROFILES_DIR)
        if f.endswith(".json")
    )


def load_profile(name: str):
    path = os.path.join(PROFILES_DIR, f"{name}.json")
    with open(path, "r") as f:
        new_cfg = json.load(f)
    st.session_state.config = new_cfg
    # Overwrite every widget-state key so the inputs display the loaded values.
    # Simply deleting them is not enough — Streamlit can restore them from its
    # internal widget cache. Setting them explicitly is the reliable approach.
    for key, value in new_cfg.items():
        st.session_state[f"_w_{key}"] = value


def save_profile(name: str):
    path = os.path.join(PROFILES_DIR, f"{name}.json")
    with open(path, "w") as f:
        json.dump(st.session_state.config, f, indent=2)


# --- Sidebar: profile management ---
with st.sidebar:
    st.header("Profielbeheer")

    profiles = list_saved_profiles()
    options = ["-- Standaard --"] + profiles
    selected = st.selectbox("Profiel laden", options, key="sb_profile_select")

    if st.button("Laden", use_container_width=True):
        if selected == "-- Standaard --":
            st.session_state.config = DEFAULT_CONFIG.copy()
            for key, value in DEFAULT_CONFIG.items():
                st.session_state[f"_w_{key}"] = value
            st.toast("Standaard profiel geladen")
        else:
            load_profile(selected)
            st.toast(f"Profiel '{selected}' geladen")
        st.rerun()

    st.divider()
    new_name = st.text_input("Profiel opslaan als", placeholder="Mijn batterij")
    if st.button("Opslaan", use_container_width=True, disabled=not new_name):
        save_profile(new_name.strip())
        st.toast(f"Profiel '{new_name.strip()}' opgeslagen")
        st.rerun()


# --- Navigation ---
configuratie_page = st.Page(
    "pages/configuratie.py",
    title="Configuratie",
    icon=":material/settings:",
    default=True,
)
financieel_page = st.Page(
    "pages/financieel.py",
    title="Financiele Analyse",
    icon=":material/analytics:",
)
optimalisatie_page = st.Page(
    "pages/optimalisatie.py",
    title="Optimale Batterij",
    icon=":material/tune:",
)

pg = st.navigation([configuratie_page, financieel_page, optimalisatie_page])
pg.run()
