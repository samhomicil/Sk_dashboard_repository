'use client'
import { useSession } from 'next-auth/react'

export type StoreLock = 'pines' | 'miramar' | 'margate'

/**
 * The one store this login is locked to, or null when it may see every store.
 * UI only: screens use it to preselect the store and hide the store picker. The server
 * enforces the same rule independently (proxy.ts + lib/store-guard.ts), so a stale or
 * missing session here can mislabel a screen but never widen what it receives.
 */
export function useStoreLock(): StoreLock | null {
  const { data } = useSession()
  return data?.user?.store ?? null
}
