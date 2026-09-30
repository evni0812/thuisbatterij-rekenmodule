import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { Foutgrens } from "../components/Foutgrens";
import "./theme.css";
import "./verloop.css";

/*
 * Zelfde letters als de Energiecontract Monitor, zodat de twee tools als
 * familie lezen. De variabelen worden in theme.css opgepakt.
 */
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Wat had een thuisbatterij opgeleverd?",
  description:
    "Wat had een thuisbatterij je bespaard zonder saldering? Reken het door " +
    "met het gemeten gemiddelde patroon in jouw netgebied en de werkelijke " +
    "uurprijzen van ANWB Energie.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="nl" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>
        <Foutgrens>{children}</Foutgrens>
      </body>
    </html>
  );
}
