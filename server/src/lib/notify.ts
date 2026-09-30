import db from '../db';
import { sendSMS } from '../utils/sms';

export interface NotifyTarget {
  userId?: number;
  userIds?: number[];
  /** Every active user with one of these roles. */
  roles?: string[];
  /** The user account linked to this employee record, if any. */
  employeeId?: string;
}

export interface NotifyOptions {
  type?: string;
  /** Module id the bell should open, e.g. 'hr-leave' or 'accounting-ap'. */
  link?: string;
  /** true to also SMS `title: body`, or a string to SMS custom text. Skipped when SMS isn't configured. */
  sms?: boolean | string;
  /** Don't notify this user (typically the person who triggered the event). */
  excludeUserId?: number;
}

/**
 * Create in-app notifications (and optionally SMS) for users. Never throws, so callers can fire it
 * after their main write without try/catch. Returns the number of users notified.
 */
export async function notify(target: NotifyTarget, title: string, body?: string, options: NotifyOptions = {}): Promise<number> {
  try {
    const query = db('users').select('id', 'phone').where(q => q.where('is_active', true).orWhereNull('is_active'));
    const ids = [...(target.userIds || []), ...(target.userId ? [target.userId] : [])];
    query.where(q => {
      if (ids.length) q.orWhereIn('id', ids);
      if (target.roles?.length) q.orWhereIn('role', target.roles);
      if (target.employeeId) q.orWhere('employee_id', target.employeeId);
      if (!ids.length && !target.roles?.length && !target.employeeId) q.whereRaw('false');
    });
    let users: Array<{ id: number; phone: string | null }> = await query;
    if (options.excludeUserId) users = users.filter(u => u.id !== options.excludeUserId);
    if (!users.length) return 0;

    await db('notifications').insert(users.map(u => ({
      user_id: u.id,
      type: options.type || 'info',
      title: title.slice(0, 255),
      body: body ?? null,
      link: options.link ?? null,
    })));

    if (options.sms) {
      const text = typeof options.sms === 'string' ? options.sms : body ? `${title}: ${body}` : title;
      await Promise.all(users.filter(u => u.phone).map(u => sendSMS(u.phone as string, text)));
    }
    return users.length;
  } catch (error) {
    console.error(`[notify] Failed to send "${title}":`, (error as Error).message);
    return 0;
  }
}
