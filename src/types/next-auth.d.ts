import { DefaultSession } from 'next-auth'

// Extend the session user with our own fields. `role` gates the financial
// (bills) modules: owners see them, managers don't.
declare module 'next-auth' {
  interface Session {
    user: {
      id?: string
      role?: 'owner' | 'manager'
      // The one store this login may see. undefined = every store (owners);
      // null = signed in but assigned to no store.
      store?: 'pines' | 'miramar' | 'margate' | null
    } & DefaultSession['user']
  }
}
