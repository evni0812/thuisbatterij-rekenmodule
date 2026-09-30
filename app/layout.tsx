import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { Foutgrens } from "../components/Foutgrens";
import "./theme.css";
import "./verloop.css";
import "./gids.css";
import "./gids-invoer.css";
import "./gids-dag.css";
import "./gids-uitkomst.css";

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

const TITEL = "Thuisbatterij Rekentool: wat had een thuisbatterij je bespaard?";
const OMSCHRIJVING =
  "Reken uit wat een thuisbatterij je had bespaard zonder saldering, met een " +
  "dynamisch energiecontract. Op de werkelijke uurprijzen van 2024 en 2025, " +
  "de belasting van nu en het gemeten gemiddelde verbruik in jouw netgebied. " +
  "Met terugverdientijd, het nettarief van 2029 en de CO2 die je scheelt.";

export const metadata: Metadata = {
  metadataBase: new URL("https://thuisbatterij-rekenmodule.vercel.app"),
  title: {
    default: TITEL,
    template: "%s | Thuisbatterij Rekentool",
  },
  description: OMSCHRIJVING,
  applicationName: "Thuisbatterij Rekentool",
  authors: [{ name: "ANWB" }],
  keywords: [
    "thuisbatterij",
    "rekentool",
    "saldering",
    "salderingsregeling 2027",
    "dynamisch energiecontract",
    "terugverdientijd",
    "zonnepanelen",
    "nettarief 2029",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "nl_NL",
    url: "/",
    siteName: "Thuisbatterij Rekentool",
    title: TITEL,
    description: OMSCHRIJVING,
  },
  twitter: {
    card: "summary_large_image",
    title: TITEL,
    description: OMSCHRIJVING,
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#23504f",
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
