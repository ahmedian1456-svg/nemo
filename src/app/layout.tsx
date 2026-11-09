import type { Metadata } from "next";
import { Cairo, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

// خط عربي واضح للوحة الإدارة
const cairo = Cairo({
  variable: "--font-geist-sans",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "لوحة إدارة مولّد الوسائط — MCP",
  description:
    "خادم MCP لتوليد الصور والفيديو بالذكاء الاصطناعي ودمج المقاطع — إدارة المفاتيح ومتابعة المهام حيًا",
  icons: { icon: "/logo.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body className={`${cairo.variable} ${geistMono.variable} antialiased`}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
