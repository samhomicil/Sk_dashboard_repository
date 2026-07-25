import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export default function middleware(_req: NextRequest) {
  return NextResponse.next()
}
