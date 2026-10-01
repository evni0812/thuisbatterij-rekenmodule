/**
 * Het logo van een batterijmerk, of het woord "Generiek" voor de merkloze
 * thuisaccu's. Altijd een lokaal bestand uit public/logos: de CSP laat alleen
 * img-src 'self' data: toe, dus er wordt niets van het merk zelf geladen.
 *
 * Bronnen van de logo's (peildatum 2026-10-01):
 * - Zendure   https://www.zendure.nl/cdn/shop/files/logo_en.svg
 *             (de slogan eronder is weggelaten en de tekening bijgesneden)
 * - Sessy     https://www.sessy.nl/wp-content/themes/sessy/images/sessy.svg
 * - AlphaESS  https://www.alphaess.nl/cdn/shop/t/67/assets/alphaess-logo-color.svg
 * - Anker     https://commons.wikimedia.org/wiki/File:Anker_logo.svg
 *             (Wikimedia Commons, bron anker.com; metadata van de editor weggelaten)
 * - HomeWizard https://cdn.homewizard.com/wp-content/themes/smart-home-child-6/images/blackhwlogo.svg
 * - Marstek   https://marstekenergy.com/cdn/shop/files/Marstek_logo_-1.png
 *             (PNG van 260 bij 28 pixels; een SVG is er niet gevonden)
 *
 * Elk SVG-bestand bevat alleen vectortekening: geen script, geen externe
 * verwijzing, geen foreignObject (tests/batterij-catalogus.test.ts).
 */

export function MerkLogo({ merk, logo }: { merk: string; logo?: string }) {
  if (!logo) return <span className="merk-generiek">Generiek</span>;
  // Vaste hoogte; de breedte volgt de verhouding van het logo.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="merk-logo" src={logo} alt={merk} height={20} />;
}
