import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'StorageTierRecoveryDesk',
  description: 'Find the money trapped in mis-tiered, over-retained, and snapshot-bloated cloud storage and turn it into a prioritized recovery plan.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100 min-h-screen antialiased">{children}</body>
    </html>
  )
}
