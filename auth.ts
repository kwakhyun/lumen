import NextAuth from 'next-auth';
import { createAuthConfig } from '@/lib/auth/config';
import { resolveOwnerLink } from '@/lib/auth/owner-link';
import { getSqliteBinding } from '@/lib/runtime/sqlite-binding';

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...createAuthConfig(async identity => {
    const db=getSqliteBinding();
    if(!db)throw new Error('Authentication database is unavailable.');
    return resolveOwnerLink(db,identity,process.env.AUTH_LEGACY_OWNER_MAP);
  }),
  logger:{error(error){console.error('[authentication]',error.name);},warn(code){console.warn('[authentication]',code);}},
});
