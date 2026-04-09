import axios from 'axios';
import db from '../db';

export async function sendSMS(to: string, message: string) {
  try {
    const config = await db('sms_configurations').first();

    if (!config || !config.api_key) {
      console.warn('SMS not configured. Mocking output:');
      console.log(`[SMS MOCK] To: ${to}, Message: ${message}`);
      return true;
    }

    const { provider, api_key, api_secret, sender_id } = config;

    if (provider === 'Hubtel') {
      // Hubtel API v1 (Legacy) or v2 - using a common REST structure
      const hubtelUrl = `https://api.hubtel.com/v1/messages/send?From=${sender_id}&To=${to}&Content=${encodeURIComponent(message)}&ClientId=${api_key}&ClientSecret=${api_secret}`;
      await axios.get(hubtelUrl);
    } else if (provider === 'Twilio') {
      const auth = Buffer.from(`${api_key}:${api_secret}`).toString('base64');
      await axios.post(
        `https://api.twilio.com/2010-04-01/Accounts/${api_key}/Messages.json`,
        new URLSearchParams({
          To: to,
          From: sender_id,
          Body: message,
        }),
        {
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );
    } else {
      console.log(`[SMS ${provider} MOCK] To: ${to}, Content: ${message}`);
    }

    return true;
  } catch (error) {
    console.error('Error sending SMS:', error);
    return false;
  }
}
