import type { Metadata, Viewport } from "next";
import { Fraunces, Nunito } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"], weight: ["600", "700"] });
const nunito = Nunito({ variable: "--font-nunito", subsets: ["latin"], weight: ["400", "600", "700", "800"] });

export const metadata: Metadata = {
  title: "Kitty",
  description: "Plan, pay and save with friends, without anyone fronting money, chasing debts or overspending.",
  applicationName: "Kitty",
  appleWebApp: { capable: true, title: "Kitty", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#cbebdb",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${fraunces.variable} ${nunito.variable} h-full antialiased`}>
      <body>{children}</body>
    </html>
  );
}
