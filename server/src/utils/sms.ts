import axios from 'axios';
import db from '../db';

const DEFAULT_SMS_URL = 'https://sms.smsnotifygh.com/smsapi?key={key}&to={to}&msg={msg}&sender_id={sender}';

export function normalizePhone(phone: string): string {
  // Remove all non-numeric characters
  let clean = String(phone || '').replace(/\D/g, '');
  
  // If it starts with 0 and has 10 digits (GH local format), replace 0 with 233
  if (clean.startsWith('0') && clean.length === 10) {
    clean = '233' + clean.substring(1);
  }
  
  // If it doesn't start with 233 and is 9 digits, prepend 233
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

// The API key comes from SMS_API_KEY on the host; a key saved by an admin in Settings is used
// only when the env var is not set. Provider, URL and sender still come from Settings.
async function resolveConfig() {
  const row = await db('sms_configurations').first().catch(() => null);
  const envKey = process.env.SMS_API_KEY?.trim();
  const api_key = envKey || row?.api_key?.trim() || '';
  return {
    provider: row?.provider || 'Custom',
    api_key,
    api_secret: process.env.SMS_API_SECRET?.trim() || row?.api_secret?.trim() || '',
    sender_id: process.env.SMS_SENDER_ID?.trim() || row?.sender_id?.trim() || '',
    api_url: row?.api_url || process.env.SMS_API_URL || DEFAULT_SMS_URL,
  };
}

export async function isSmsConfigured(): Promise<boolean> {
  const config = await resolveConfig();
  return !!config.api_key;
}

export async function sendSMS(to: string, message: string): Promise<SMSResult> {
  const normalizedTo = normalizePhone(to);

  try {
    const config = await resolveConfig();

    if (!config.api_key) {
      console.warn(`[SMS Service] SMS disabled (no SMS_API_KEY and no key in Settings); message to ${normalizedTo} not sent.`);
      return { success: false, disabled: true, error: 'SMS is not configured' };
    }
    console.log(`[SMS Service] Sending to: ${normalizedTo}`);

    const { provider, api_key, api_secret, sender_id } = config;

    if (provider === 'Hubtel') {
      // Hubtel modern API using POST for reliability
      await axios.post(
        'https://api.hubtel.com/v1/messages/send',
        {
          From: sender_id,
          To: normalizedTo,
          Content: message,
          ClientId: api_key,
          ClientSecret: api_secret
        }
      );
    } else if (provider === 'Twilio') {
      const auth = Buffer.from(`${api_key}:${api_secret}`).toString('base64');
      await axios.post(
        `https://api.twilio.com/2010-04-01/Accounts/${api_key}/Messages.json`,
        new URLSearchParams({ To: normalizedTo, From: sender_id, Body: message }),
        {
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );
    } else if (config.api_url) {
      // Support for custom URLs. 
      // If it's SMSNotifyGH and they just provided the base URL, we'll auto-append the format they need.
      let finalUrl = config.api_url;
      
      const hasPlaceholders = finalUrl.includes('{to}') || finalUrl.includes('{key}');
      
      if (!hasPlaceholders && finalUrl.includes('smsnotifygh.com')) {
        const separator = finalUrl.includes('?') ? '&' : '?';
        finalUrl = `${finalUrl}${separator}key=${encodeURIComponent(api_key)}&to=${normalizedTo}&msg=${encodeURIComponent(message)}&sender_id=${encodeURIComponent(sender_id || '')}`;
      } else {
        // Standard placeholder replacement
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
      await axios.get(finalUrl);
    } else {
      console.error(`Unknown SMS provider: ${provider}`);
      return { success: false, error: 'Unknown provider' };
    }

    return { success: true };
  } catch (error: any) {
    console.error('Error sending SMS:', error.response?.data || error.message);
    return { success: false, error: error.message };
  }
}
