import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { SesionDesdeFragmento } from "@/components/SesionDesdeFragmento";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CacaoHedge — apoyo a decisiones de cobertura",
  description:
    "Análisis de cobertura con futuros y opciones de cacao (ICE, CC) para exportadores colombianos.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es-CO"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        {/* Canjea los tokens que los enlaces de recuperación dejan en el
            fragmento de la URL. Sin fragmento no renderiza nada. */}
        <SesionDesdeFragmento />
        {children}
      </body>
    </html>
  );
}
