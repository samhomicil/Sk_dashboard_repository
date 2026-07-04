import type { Metadata } from 'next'
import './globals.css'
import Providers from '@/components/Providers'

export const metadata: Metadata = {
  title: 'SK Wellness Dashboard',
  description: 'SK Wellness Performance Dashboard',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen pb-12">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
