import { Inter } from "next/font/google";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap"
});

export const metadata = {
  title: "Lumela",
  description: "Live local power status reports",
  manifest: "/manifest.json",
  // Same file the PWA manifest and header both use -- one mark, three
  // places, instead of the browser tab having no icon at all (there was
  // no <link rel="icon"> anywhere previously) while the header rendered
  // an unrelated live Lucide icon as a stand-in logo.
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg"
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Lumela"
  }
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#101114"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
