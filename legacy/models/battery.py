"""
Battery model with charge/discharge logic, SoC tracking, efficiency losses, and cycle counting.
"""

from dataclasses import dataclass, field


@dataclass
class BatteryConfig:
    capacity_kwh: float = 10.0
    dod_pct: float = 95.0
    max_power_kw: float = 3.6
    round_trip_efficiency_pct: float = 92.0
    cycle_life: int = 8000
    degradation_pct_year: float = 1.5
    cost_eur: float = 6000.0

    @property
    def usable_capacity_kwh(self) -> float:
        return self.capacity_kwh * (self.dod_pct / 100.0)

    @property
    def one_way_efficiency(self) -> float:
        return (self.round_trip_efficiency_pct / 100.0) ** 0.5

    @classmethod
    def from_config_dict(cls, cfg: dict) -> "BatteryConfig":
        return cls(
            capacity_kwh=cfg["batterij_capaciteit_kwh"],
            dod_pct=cfg["batterij_dod_pct"],
            max_power_kw=cfg["batterij_max_power_kw"],
            round_trip_efficiency_pct=cfg["batterij_efficiency_pct"],
            cycle_life=cfg["batterij_cycli_levensduur"],
            degradation_pct_year=cfg["batterij_degradatie_pct_jaar"],
            cost_eur=cfg["batterij_kosten_eur"],
        )


@dataclass
class BatteryState:
    soc_kwh: float = 0.0
    total_charged_kwh: float = 0.0
    total_discharged_kwh: float = 0.0
    equivalent_cycles: float = 0.0


class Battery:
    """Simulates a home battery with charge/discharge limits and efficiency losses."""

    def __init__(self, config: BatteryConfig, year: int = 0):
        self.config = config
        degradation = (1.0 - config.degradation_pct_year / 100.0) ** year
        self.effective_usable = config.usable_capacity_kwh * degradation
        self.state = BatteryState()

    def charge(self, energy_kwh: float, hours: float = 1.0) -> float:
        """
        Attempt to charge the battery.
        Returns the actual energy drawn from the source (before efficiency loss).
        """
        if energy_kwh <= 0:
            return 0.0

        max_charge_kwh = self.config.max_power_kw * hours
        available_space = self.effective_usable - self.state.soc_kwh

        stored = min(energy_kwh * self.config.one_way_efficiency, max_charge_kwh, available_space)
        if stored <= 0:
            return 0.0

        drawn_from_source = stored / self.config.one_way_efficiency
        self.state.soc_kwh += stored
        self.state.total_charged_kwh += stored
        self._update_cycles(stored)
        return drawn_from_source

    def discharge(self, energy_kwh: float, hours: float = 1.0) -> float:
        """
        Attempt to discharge the battery.
        Returns the actual usable energy delivered (after efficiency loss).
        """
        if energy_kwh <= 0:
            return 0.0

        max_discharge_kwh = self.config.max_power_kw * hours
        available = self.state.soc_kwh

        from_battery = min(energy_kwh / self.config.one_way_efficiency, max_discharge_kwh, available)
        if from_battery <= 0:
            return 0.0

        delivered = from_battery * self.config.one_way_efficiency
        self.state.soc_kwh -= from_battery
        self.state.total_discharged_kwh += delivered
        self._update_cycles(from_battery)
        return delivered

    def _update_cycles(self, energy_kwh: float):
        if self.effective_usable > 0:
            self.state.equivalent_cycles += energy_kwh / self.effective_usable

    @property
    def soc_pct(self) -> float:
        if self.effective_usable <= 0:
            return 0.0
        return (self.state.soc_kwh / self.effective_usable) * 100.0
