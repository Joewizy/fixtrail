import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "FixTrail — Pick up where you left off",
  description:
    "A developer troubleshooting assistant that remembers your environment, failed attempts, and confirmed fixes.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
