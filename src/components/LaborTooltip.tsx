'use client'

interface Props {
  labor: number | null | undefined
  hours: number | null | undefined
  children: React.ReactNode
}

export default function LaborTooltip({ labor, hours, children }: Props) {
  if (!labor && !hours) return <>{children}</>

  const parts: string[] = []
  if (labor) parts.push(`$${Math.round(labor).toLocaleString()}`)
  if (hours) parts.push(`${Math.round(hours)} hrs`)

  return (
    <span className="relative group cursor-default">
      {children}
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block bg-slate-800 text-white text-[10px] rounded px-2 py-1 whitespace-nowrap z-50 pointer-events-none shadow-lg">
        {parts.join(' · ')}
      </span>
    </span>
  )
}
