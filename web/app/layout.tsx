import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'StorageTierRecoveryDesk',
  description: 'Find the money trapped in mis-tiered, over-retained, and snapshot-bloated cloud storage and turn it into a prioritized recovery plan.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="bg-zinc-950 text-zinc-100 min-h-screen antialiased font-sans">{children}</body>
    </html>
  )
}
