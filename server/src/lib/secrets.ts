import crypto from 'crypto';
import db from '../db';

const WEAK_SECRETS = new Set(['your-secret-key', 'secret', 'changeme', 'jwt_secret']);

let jwtSecret: string | null = null;

// Resolution order: JWT_SECRET env var, then the random secret generated into app_secrets by
// migration, then (last resort, logged loudly) a per-process random secret.
export async function initJwtSecret(): Promise<void> {
  const fromEnv = process.env.JWT_SECRET?.trim();
  if (fromEnv && !WEAK_SECRETS.has(fromEnv)) {
    if (fromEnv.length < 32) console.warn('⚠️  JWT_SECRET is shorter than 32 characters; use a longer random value.');
    jwtSecret = fromEnv;
    return;
  }
  if (fromEnv) console.error('❌ JWT_SECRET is set to a known placeholder value and will be ignored.');

  try {
    const row = await db('app_secrets').where({ key: 'jwt_secret' }).first();
    if (row?.value) {
      console.warn('⚠️  JWT_SECRET env var not set; using the secret stored in the database. Set JWT_SECRET on the host.');
      jwtSecret = row.value;
      return;
    }
  } catch (error) {
    console.error('❌ Could not read JWT secret from database:', (error as Error).message);
  }

  console.error('❌ No JWT secret available. Using a temporary random secret; all sessions will end on restart. Set JWT_SECRET.');
  jwtSecret = crypto.randomBytes(48).toString('hex');
}

export function getJwtSecret(): string {
  if (!jwtSecret) throw new Error('JWT secret not initialised');
  return jwtSecret;
}
