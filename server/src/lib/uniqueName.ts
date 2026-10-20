import type { Knex } from 'knex';

type Conn = Knex | Knex.Transaction;

/** One space between words, no leading or trailing space. */
export function cleanName(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

const LABELS: Record<string, string> = {
  employees: 'Employee',
  users: 'Login',
  suppliers: 'Supplier',
  projects: 'Project',
  services: 'Service',
  inventory_items: 'Inventory item',
  equipment: 'Equipment',
  chart_of_accounts: 'Account',
};

const nameKey = `lower(regexp_replace(btrim(name), '\\s+', ' ', 'g'))`;

/**
 * Stops two requests from inserting the same name before either row exists.
 * The connection must be inside a transaction; the lock ends when it commits.
 */
export async function lockName(conn: Conn, scope: string, name: string): Promise<void> {
  await conn.raw('SELECT pg_advisory_xact_lock(hashtext(?)::bigint)', [`name:${scope}:${cleanName(name).toLowerCase()}`]);
}

/** Another row in the same table already uses this name. Account names are unique per type. */
export async function duplicateName(
  conn: Conn,
  table: string,
  name: string,
  opts: { excludeId?: string | number | null; type?: string } = {},
): Promise<string | null> {
  const cleaned = cleanName(name);
  if (!cleaned) return null;
  const query = conn(table).whereRaw(`${nameKey} = lower(?)`, [cleaned]);
  if (opts.type) query.where('type', opts.type);
  if (opts.excludeId !== undefined && opts.excludeId !== null && String(opts.excludeId) !== '') {
    query.whereNot('id', opts.excludeId);
  }
  const row = await query.first('id', 'name');
  if (!row) return null;
  const kind = LABELS[table] || 'Record';
  const typed = opts.type ? ` (${opts.type})` : '';
  return `${kind} "${row.name}"${typed} is already on file (${row.id}). Use that record instead of adding the name again.`;
}

/**
 * A person name may exist once as an employee and once on the login linked to
 * that same employee. It must not be copied onto anyone else.
 */
export async function personNameClash(
  conn: Conn,
  name: string,
  keep: { employeeId?: string | null; userId?: number | null } = {},
): Promise<string | null> {
  const employee = await duplicateName(conn, 'employees', name, { excludeId: keep.employeeId });
  if (employee) return employee;
  const cleaned = cleanName(name);
  if (!cleaned) return null;
  const query = conn('users').whereRaw(`${nameKey} = lower(?)`, [cleaned]);
  if (keep.userId) query.whereNot('id', keep.userId);
  if (keep.employeeId) {
    query.where(function (this: Knex.QueryBuilder) {
      this.whereNull('employee_id').orWhereNot('employee_id', keep.employeeId as string);
    });
  }
  const user = await query.first('email', 'name');
  if (!user) return null;
  return `The name "${user.name}" is already used by the login ${user.email}.`;
}
