import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
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
    "Reken door wat een thuisbatterij je had bespaard zonder saldering, " +
    "op basis van werkelijke kwartierprofielen en werkelijke uurtarieven.",
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
      <body>{children}</body>
    </html>
  );
}
