import axios from 'axios';
import db from '../db';

export const INTEK_DEFAULT_URL = 'https://www.inteksms.top/api/v1';
const REQUEST_TIMEOUT_MS = 15000;

export type SmsProvider = 'intek' | 'hubtel' | 'twilio' | 'url';

export function normalizePhone(phone: string): string {
  let clean = String(phone || '').replace(/\D/g, '');

  if (clean.startsWith('00')) clean = clean.substring(2);

  // Ghana local format: 0XXXXXXXXX -> 233XXXXXXXXX
  if (clean.startsWith('0') && clean.length === 10) {
    clean = '233' + clean.substring(1);
  }

  if (clean.length === 9 && !clean.startsWith('233')) {
    clean = '233' + clean;
  }

  return clean;
}

export interface SMSResult {
  success: boolean;
  disabled?: boolean;
  error?: string;
}

export interface SmsConfig {
  provider: SmsProvider;
  api_key: string;
  api_secret: string;
  sender_id: string;
  api_url: string;
  key_source: 'env' | 'settings' | null;
}

function isUrlTemplate(url: string) {
  return url.includes('{') || /smsnotifygh\.com/i.test(url);
}

function toProvider(value: string | undefined | null): SmsProvider | null {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return null;
  if (v.includes('intek')) return 'intek';
  if (v.includes('hubtel')) return 'hubtel';
  if (v.includes('twilio')) return 'twilio';
  if (v === 'url' || v === 'custom') return 'url';
  return null;
}

// Env vars (SMS_PROVIDER, SMS_API_KEY, SMS_API_SECRET, SMS_SENDER_ID, SMS_API_URL) win over
// values saved by an admin in Settings. With nothing configured the provider is Intek SMS.
export async function resolveSmsConfig(): Promise<SmsConfig> {
  const row = await db('sms_configurations').first().catch(() => null);
  const envKey = process.env.SMS_API_KEY?.trim() || '';
  const rowKey = row?.api_key?.trim() || '';
  const envUrl = process.env.SMS_API_URL?.trim() || '';
  const rowUrl = row?.api_url?.trim() || '';
  const api_url = envUrl || rowUrl;

  let provider = toProvider(process.env.SMS_PROVIDER) || toProvider(row?.provider);
  if (!provider) provider = api_url && isUrlTemplate(api_url) ? 'url' : 'intek';

  return {
    provider,
    api_key: envKey || rowKey,
    api_secret: process.env.SMS_API_SECRET?.trim() || row?.api_secret?.trim() || '',
    sender_id: process.env.SMS_SENDER_ID?.trim() || row?.sender_id?.trim() || '',
    api_url,
    key_source: envKey ? 'env' : rowKey ? 'settings' : null,
  };
}

export async function isSmsConfigured(): Promise<boolean> {
  const config = await resolveSmsConfig();
  return !!config.api_key;
}

function intekBaseUrl(url: string) {
  if (!url || isUrlTemplate(url) || !/^https?:\/\//i.test(url)) return INTEK_DEFAULT_URL;
  return url.replace(/\/+$/, '').replace(/\/messages\/send$/i, '');
}

function intekClient(config: SmsConfig) {
  return axios.create({
    baseURL: intekBaseUrl(config.api_url),
    timeout: REQUEST_TIMEOUT_MS,
    headers: { Authorization: `Bearer ${config.api_key}`, 'Content-Type': 'application/json' },
    validateStatus: () => true,
  });
}

// Intek's public docs sit behind the dashboard login. Its API answers
// 422 "No valid recipients found" (without sending) when it does not recognise the recipient
// field, so the known shapes are tried in order and the first accepted one is remembered.
const INTEK_RECIPIENT_SHAPES: Array<(to: string) => Record<string, unknown>> = [
  (to) => ({ recipients: [to] }),
  (to) => ({ recipients: to }),
  (to) => ({ to }),
  (to) => ({ phone: to }),
  (to) => ({ phones: [to] }),
  (to) => ({ numbers: to }),
];
let intekShapeIndex: number | null = null;

async function sendViaIntek(config: SmsConfig, to: string, message: string): Promise<SMSResult> {
  if (!config.sender_id) return { success: false, error: 'SMS sender ID is not set (SMS_SENDER_ID)' };
  const client = intekClient(config);
  const sender = /^\d+$/.test(config.sender_id) ? { sender_id: Number(config.sender_id) } : { sender: config.sender_id };
  const order = intekShapeIndex === null
    ? INTEK_RECIPIENT_SHAPES.map((_, i) => i)
    : [intekShapeIndex];

  let lastError = 'No valid recipients found';
  for (const i of order) {
    const res = await client.post('/messages/send', { message, ...sender, ...INTEK_RECIPIENT_SHAPES[i](to) });
    const data = res.data || {};
    if (res.status < 300 && data.ok === true) {
      intekShapeIndex = i;
      return { success: true };
    }
    lastError = String(data.error || `HTTP ${res.status}`);
    if (!(res.status === 422 && /no valid recipients/i.test(lastError))) break;
  }
  return { success: false, error: lastError };
}

export async function sendSMS(to: string, message: string): Promise<SMSResult> {
  const normalizedTo = normalizePhone(to);

  try {
    const config = await resolveSmsConfig();

    if (!config.api_key) {
      console.warn(`[SMS Service] SMS disabled (no SMS_API_KEY and no key in Settings); message to ${normalizedTo} not sent.`);
      return { success: false, disabled: true, error: 'SMS is not configured' };
    }
    if (!/^\d{9,15}$/.test(normalizedTo)) {
      return { success: false, error: 'Invalid phone number' };
    }
    console.log(`[SMS Service] Sending to ${normalizedTo} via ${config.provider}`);

    const { provider, api_key, api_secret, sender_id } = config;
    let result: SMSResult = { success: true };

    if (provider === 'intek') {
      result = await sendViaIntek(config, normalizedTo, message);
    } else if (provider === 'hubtel') {
      await axios.post(
        'https://api.hubtel.com/v1/messages/send',
        { From: sender_id, To: normalizedTo, Content: message, ClientId: api_key, ClientSecret: api_secret },
        { timeout: REQUEST_TIMEOUT_MS }
      );
    } else if (provider === 'twilio') {
      const auth = Buffer.from(`${api_key}:${api_secret}`).toString('base64');
      await axios.post(
        `https://api.twilio.com/2010-04-01/Accounts/${api_key}/Messages.json`,
        new URLSearchParams({ To: normalizedTo, From: sender_id, Body: message }),
        {
          timeout: REQUEST_TIMEOUT_MS,
          headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        }
      );
    } else if (config.api_url) {
      let finalUrl = config.api_url;
      const hasPlaceholders = finalUrl.includes('{to}') || finalUrl.includes('{key}');

      if (!hasPlaceholders && finalUrl.includes('smsnotifygh.com')) {
        const separator = finalUrl.includes('?') ? '&' : '?';
        finalUrl = `${finalUrl}${separator}key=${encodeURIComponent(api_key)}&to=${normalizedTo}&msg=${encodeURIComponent(message)}&sender_id=${encodeURIComponent(sender_id || '')}`;
      } else {
        finalUrl = finalUrl
          .replace('{key}', encodeURIComponent(api_key))
          .replace('{to}', normalizedTo)
          .replace('{msg}', encodeURIComponent(message))
          .replace('{message}', encodeURIComponent(message))
          .replace('{sender}', encodeURIComponent(sender_id || ''))
          .replace('{sender_id}', encodeURIComponent(sender_id || ''))
          .replace('{secret}', encodeURIComponent(api_secret || ''));
      }

      console.log(`[SMS Service] Dispatching to custom URL: ${finalUrl.split('?')[0]}...`);
      await axios.get(finalUrl, { timeout: REQUEST_TIMEOUT_MS });
    } else {
      return { success: false, error: 'No SMS API URL configured for the custom provider' };
    }

    if (!result.success) console.error(`[SMS Service] ${provider} rejected SMS to ${normalizedTo}: ${result.error}`);
    return result;
  } catch (error: any) {
    const detail = error.response?.data?.error || error.response?.data || error.message;
    console.error(`[SMS Service] Error sending SMS to ${normalizedTo}:`, typeof detail === 'string' ? detail : JSON.stringify(detail));
    return { success: false, error: error.message };
  }
}

export interface SmsStatus {
  configured: boolean;
  provider: SmsProvider;
  sender_id: string;
  key_source: 'env' | 'settings' | null;
  balance_units?: number;
  sender_approved?: boolean | null;
  error?: string;
}

// Read-only account check (no SMS is sent). Only Intek exposes balance and sender-ID status.
export async function getSmsStatus(): Promise<SmsStatus> {
  const config = await resolveSmsConfig();
  const status: SmsStatus = {
    configured: !!config.api_key,
    provider: config.provider,
    sender_id: config.sender_id,
    key_source: config.key_source,
  };
  if (!config.api_key || config.provider !== 'intek') return status;

  try {
    const client = intekClient(config);
    const [balance, senders] = await Promise.all([client.get('/balance'), client.get('/sender-ids')]);
    if (balance.data?.ok !== true) {
      status.error = String(balance.data?.error || `HTTP ${balance.status}`);
      return status;
    }
    status.balance_units = Number(balance.data.data?.balance_units ?? 0);
    const list: any[] = senders.data?.data?.sender_ids || [];
    const match = list.find((s) =>
      String(s.sender_name).toLowerCase() === config.sender_id.toLowerCase() || String(s.id) === config.sender_id);
    status.sender_approved = match ? match.status === 'approved' : config.sender_id ? false : null;
  } catch (error: any) {
    status.error = error.message;
  }
  return status;
}
