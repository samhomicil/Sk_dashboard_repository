import { redirect } from 'next/navigation'
import { auth, signIn } from '@/auth'

function isAccessDenied(error?: string) {
  return error === 'AccessDenied'
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>
}) {
  const session = await auth()
  const { error, callbackUrl } = await searchParams
  const safeCallback = callbackUrl && callbackUrl.startsWith('/') ? callbackUrl : '/'

  // Already signed in (and allowlisted) — skip the login screen.
  if (session?.user && !isAccessDenied(error)) {
    redirect(safeCallback)
  }

  const denied = isAccessDenied(error)

  async function signInWithGoogle() {
    'use server'
    await signIn('google', { redirectTo: safeCallback })
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 w-full max-w-sm text-center">
        <div className="w-14 h-14 bg-teal-700 rounded-full flex items-center justify-center text-white text-xl font-bold mx-auto mb-4">
          SK
        </div>
        <div className="text-xs text-slate-400 font-semibold uppercase tracking-wide mb-1">Hispaniola Wellness</div>
        <div className="text-xl font-bold text-slate-800 mb-1">Performance Dashboard</div>

        {denied ? (
          <>
            <div className="mt-3 mb-6 rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700">
              This account isn&apos;t authorized to view the SK dashboard. Try a different Google
              account, or contact the owner if you think this is a mistake.
            </div>
            <form action={signInWithGoogle}>
              <GoogleButton label="Try a different account" />
            </form>
          </>
        ) : (
          <>
            <div className="text-sm text-slate-400 mb-8">Sign in with your team Google account</div>
            <form action={signInWithGoogle}>
              <GoogleButton label="Sign in with Google" />
            </form>
          </>
        )}
      </div>
    </div>
  )
}

function GoogleButton({ label }: { label: string }) {
  return (
    <button
      type="submit"
      className="w-full flex items-center justify-center gap-3 border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
    >
      {/* Google's own mark keeps Google's colours — it is somebody else's brand,
            and recolouring a sign-in button's logo is how it stops being recognisable. */}
          <svg width="18" height="18" viewBox="0 0 18 18">
        <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
        <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
        <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
        <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"/>
      </svg>
      {label}
    </button>
  )
}
