import Google from 'next-auth/providers/google';
import type { NextAuthConfig } from 'next-auth';
import { verifiedGoogleIdentity } from './identity';

type ResolveOwner = (profile: ReturnType<typeof verifiedGoogleIdentity>) => Promise<string>;
/** The provider verifies OIDC; only verified provider callbacks may set an owner. */
export function createAuthConfig(resolveOwner: ResolveOwner): NextAuthConfig {
  return {
    providers: [Google({checks:['pkce','state','nonce']})],
    session: { strategy:'jwt', maxAge:7*24*60*60 },
    pages: { signIn:'/sign-in', error:'/sign-in' },
    callbacks: {
      async signIn({account,profile}) {
        if(account?.provider!=='google')return false;
        try {verifiedGoogleIdentity(profile);return true;}catch{return false;}
      },
      async jwt({token,account,profile}) {
        // Session-update request bodies never influence identity or ownership.
        if(account){
          if(account.provider!=='google')throw new Error('Unsupported identity provider.');
          const identity=verifiedGoogleIdentity(profile);
          token.ownerId=await resolveOwner(identity);
          token.email=identity.email;
          token.name=identity.name;
        }
        return token;
      },
      async session({session,token}) {
        if(typeof token.ownerId!=='string'||!token.ownerId)throw new Error('Invalid authenticated session.');
        session.user.id=token.ownerId;
        session.user.email=token.email||'';
        return session;
      },
    },
  };
}
