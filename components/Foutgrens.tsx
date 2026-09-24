"use client";

/**
 * Een vangnet rond de hele pagina.
 *
 * Gooit een component tijdens het tekenen — een bewaard antwoord met een veld
 * dat ontbreekt, een browser die iets niet kent — dan laat React zonder
 * vangnet een wit scherm achter, zonder één woord uitleg. Dit zet er een
 * melding neer met een knop om de pagina opnieuw te laden, en laat de fout in
 * de console staan voor wie hem wil zien.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

export class Foutgrens extends Component<{ children: ReactNode }, { fout: Error | null }> {
  state: { fout: Error | null } = { fout: null };

  static getDerivedStateFromError(fout: Error) {
    return { fout };
  }

  componentDidCatch(fout: Error, info: ErrorInfo): void {
    console.error("De pagina liep vast:", fout, info.componentStack);
  }

  render() {
    if (!this.state.fout) return this.props.children;
    return (
      <main className="pagina">
        <div className="notitie" role="alert">
          <p>
            <b>Er ging iets mis bij het tonen van de pagina.</b> Laad de pagina
            opnieuw; lukt het dan nog niet, probeer het in een andere browser.
          </p>
          <p className="fout-detail">{this.state.fout.message}</p>
          <button type="button" className="knop licht klein" onClick={() => window.location.reload()}>
            Pagina opnieuw laden
          </button>
        </div>
      </main>
    );
  }
}
