import { Geist, Geist_Mono } from "next/font/google";
import type { Metadata } from "next";
import "./globals.css";
import { ReactLenis, useLenis } from 'lenis/react';
import 'lenis/dist/lenis.css';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ShipOrNah — Free security scan for AI-generated apps",
  description:
    "Scan your Lovable, Bolt, Cursor, or v0 app for exposed API keys, missing Supabase RLS, and unprotected routes.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <ReactLenis root />
        {children}
      </body>
    </html>
  );
}
