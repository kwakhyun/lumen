export type VerifiedGoogleIdentity = { subject: string; email: string; name: string | null };
export function verifiedGoogleIdentity(profile: unknown): VerifiedGoogleIdentity {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('Invalid Google identity.');
  const p = profile as Record<string, unknown>;
  if (p.email_verified !== true || typeof p.sub !== 'string' || !/^[A-Za-z0-9_-]{1,255}$/.test(p.sub) || typeof p.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) throw new Error('A verified Google account is required.');
  return {subject:p.sub,email:p.email.toLowerCase(),name:typeof p.name==='string'?p.name.slice(0,200):null};
}
export function legacyOwnerForEmail(raw: string | undefined, email: string): string | null {
  if (!raw) return null;
  const mappings: unknown = JSON.parse(raw);
  if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings)) throw new Error('Invalid account migration configuration.');
  const owner = Object.hasOwn(mappings,email) ? (mappings as Record<string,unknown>)[email] : null;
  if (owner === null) return null;
  if (typeof owner !== 'string' || !/^[A-Za-z0-9_-]{1,255}$/.test(owner)) throw new Error('Invalid legacy owner.');
  return owner;
}
export function safeReturnPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n]/.test(value)) return '/dashboard';
  try {const url = new URL(value,'https://lumen.invalid'); if(url.origin!=='https://lumen.invalid'||/^\/(api\/auth|sign-in|sign-out|signin-with-chatgpt|signout-with-chatgpt|callback)(\/|$)/.test(url.pathname))return '/dashboard';return url.pathname+url.search+url.hash;}catch{return '/dashboard';}
}
