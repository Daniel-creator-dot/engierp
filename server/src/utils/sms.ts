import axios from 'axios';
import db from '../db';

function normalizePhone(phone: string): string {
  // Remove all non-numeric characters
  let clean = phone.replace(/\D/g, '');
  
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

export async function sendSMS(to: string, message: string) {
  const normalizedTo = normalizePhone(to);
  console.log(`[SMS Service] Sending to: ${normalizedTo} (Original: ${to})`);

  try {
    const config = await db('sms_configurations').first();

    if (!config || !config.api_key) {
      console.warn('SMS not configured. Mocking output:');
      console.log(`[SMS MOCK] To: ${normalizedTo}, Message: ${message}`);
      return { success: true, mocked: true };
    }

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
    } else {
      console.error(`Unknown SMS provider: ${provider}`);
      return { success: false, error: 'Unknown provider' };
    }

    return { success: true, mocked: false };
  } catch (error: any) {
    console.error('Error sending SMS:', error.response?.data || error.message);
    return { success: false, error: error.message };
  }
}
