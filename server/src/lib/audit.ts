import type { Knex } from 'knex';
import db from '../db';
import type { AuthRequest } from '../middleware/auth';

const SENSITIVE_KEY = /password|token|secret|api_key/i;
const MAX_STRING = 2000;

function sanitize(value: any, depth = 0): any {
  if (value === null || value === undefined) return null;
  if (depth > 5) return '[nested]';
  if (typeof value === 'string') return value.length > MAX_STRING ? `[${value.length} characters]` : value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 200).map(v => sanitize(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? (v ? '[redacted]' : v) : sanitize(v, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Record who changed what. Never throws, so it is safe to call after the main write succeeds.
 * Pass `trx` to write the entry inside the caller's transaction.
 * Password, token, secret and api_key fields are redacted; very long strings (e.g. logos) are summarised.
 */
export async function logAudit(
  req: AuthRequest | null,
  action: string,
  entity: string,
  entityId?: string | number | null,
  before?: unknown,
  after?: unknown,
  trx?: Knex | Knex.Transaction,
): Promise<void> {
  try {
    const forwarded = req?.headers?.['x-forwarded-for'];
    const ip = req ? (req.ip || (Array.isArray(forwarded) ? forwarded[0] : forwarded) || null) : null;
    await (trx || db)('audit_log').insert({
      user_id: req?.user?.id ?? null,
      user_email: req?.user?.email ?? null,
      user_role: req?.user?.role ?? null,
      action,
      entity,
      entity_id: entityId === null || entityId === undefined ? null : String(entityId),
      before: before === undefined ? null : JSON.stringify(sanitize(before)),
      after: after === undefined ? null : JSON.stringify(sanitize(after)),
      ip: ip ? String(ip).slice(0, 64) : null,
    });
  } catch (error) {
    console.error(`[audit] Failed to record ${action} ${entity} ${entityId ?? ''}:`, (error as Error).message);
  }
}
