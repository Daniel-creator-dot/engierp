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

    const { provider, api_key, api_secret, sender_id, api_url } = config;

    if (provider === 'Hubtel') {
      const hubtelUrl = `https://api.hubtel.com/v1/messages/send?From=${sender_id}&To=${to}&Content=${encodeURIComponent(message)}&ClientId=${api_key}&ClientSecret=${api_secret}`;
      await axios.get(hubtelUrl);
    } else if (provider === 'Twilio') {
      const auth = Buffer.from(`${api_key}:${api_secret}`).toString('base64');
      await axios.post(
        `https://api.twilio.com/2010-04-01/Accounts/${api_key}/Messages.json`,
        new URLSearchParams({ To: to, From: sender_id, Body: message }),
        {
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );
    } else if (api_url) {
      // Generic provider using the custom URL provided in settings
      // We'll replace placeholder keys with actual values if present in the URL
      const finalUrl = api_url
        .replace('{to}', to)
        .replace('{message}', encodeURIComponent(message))
        .replace('{key}', api_key)
        .replace('{secret}', api_secret)
        .replace('{sender}', sender_id);
      
      await axios.get(finalUrl);
    } else {
      console.log(`[SMS ${provider} MOCK] To: ${to}, Content: ${message}`);
    }

    return true;
  } catch (error) {
    console.error('Error sending SMS:', error);
    return false;
  }
}
