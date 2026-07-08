import type { Metadata } from 'next'
import './globals.css'
import Providers from '@/components/Providers'
import AppSidebar from '@/components/AppSidebar'

export const metadata: Metadata = {
  title: 'SK Wellness Dashboard',
  description: 'SK Wellness Performance Dashboard',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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
