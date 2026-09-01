import type { Metadata, Viewport } from "next";
import "./theme.css";

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
    <html lang="nl">
      <body>{children}</body>
    </html>
  );
}
