import type { Metadata } from 'next'
import { Archivo, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'
import Providers from '@/components/Providers'
import AppSidebar from '@/components/AppSidebar'

// Archivo carries everything; Plex Mono carries labels, eyebrows, timestamps and
// codes. Self-hosted by next/font — the handoff's stylesheet @imports them from
// Google, which is a render-blocking third-party request and a silent fallback to
// Helvetica when it fails. `variable` publishes the family to tokens.css.
const archivo = Archivo({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-archivo',
  display: 'swap',
})
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'SK Wellness Dashboard',
  description: 'SK Wellness Performance Dashboard',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${plexMono.variable}`}>
      <body className="min-h-screen pb-12">
        <Providers>
          <div className="flex min-h-screen">
            <AppSidebar />
            <div className="min-w-0 flex-1">{children}</div>
          </div>
        </Providers>
      </body>
    </html>
  )
}
