import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'PRISM - Prescription Recognition and Intelligent Safety for Medication',
  description: 'PRISM transforms handwritten doctor prescriptions into verified, structured digital records with clinical safety intelligence.',
  keywords: 'PRISM, prescription, OCR, AI, healthcare, India, medicine safety, drug interactions, digitization',
  authors: [{ name: 'PRISM Team' }],
  viewport: 'width=device-width, initial-scale=1',
  themeColor: '#0ea5e9',
  openGraph: {
    title: 'PRISM - Prescription Recognition and Intelligent Safety for Medication',
    description: 'Transform handwritten prescriptions into structured digital records with clinical safety intelligence',
    type: 'website',
    locale: 'en_IN',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PRISM - Prescription Recognition and Intelligent Safety for Medication',
    description: 'AI-powered prescription recognition and intelligent medication safety',
  },
  robots: {
    index: true,
    follow: true,
  },
};


export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      </head>
      <body className={`${inter.className} bg-[#060b16] text-slate-100 min-h-screen antialiased selection:bg-cyan-500/30 selection:text-cyan-200`}>
        <div className="min-h-screen flex flex-col bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#0d1c3a]/30 via-[#060b16] to-[#04070f]">
          <main className="flex-1">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}