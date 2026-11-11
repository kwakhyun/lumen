import type { SqliteDatabase } from '../runtime/sqlite-binding';
import { legacyOwnerForEmail, type VerifiedGoogleIdentity } from './identity';

/** Link once by a verified email, then always resolve by Google's stable subject. */
export async function resolveOwnerLink(db: SqliteDatabase, identity: VerifiedGoogleIdentity, legacyMap?: string): Promise<string> {
  const prior = await db.prepare('SELECT owner_id FROM auth_identity_links WHERE provider=? AND subject=?').bind('google',identity.subject).first<{owner_id:string}>();
  if(prior)return prior.owner_id;
  const owner = legacyOwnerForEmail(legacyMap,identity.email) || `google:${identity.subject}`;
  await db.prepare('INSERT INTO auth_identity_links (provider,subject,owner_id,verified_email,created_at) VALUES (?,?,?,?,?) ON CONFLICT(provider,subject) DO NOTHING').bind('google',identity.subject,owner,identity.email,new Date().toISOString()).run();
  const saved=await db.prepare('SELECT owner_id FROM auth_identity_links WHERE provider=? AND subject=?').bind('google',identity.subject).first<{owner_id:string}>();
  if(!saved||saved.owner_id!==owner)throw new Error('Account ownership link conflict.');
  return saved.owner_id;
}
