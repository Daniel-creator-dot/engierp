import knex from 'knex';

const connectionString = 'postgresql://postgres.udajgnvqizrnluldmnni:Daniel@24419000@aws-0-eu-west-1.pooler.supabase.com:5432/postgres';

const db = knex({
  client: 'postgresql',
  connection: {
    connectionString,
    ssl: { rejectUnauthorized: false }
  }
});

async function check() {
  try {
    console.log('--- Checking Users Table ---');
    const users = await db('users').select('id', 'email', 'role');
    console.log(`Found ${users.length} users.`);
    console.log('Sample User:', users[0]);

    console.log('\n--- Checking Settings Table ---');
    const settings = await db('settings').select('key');
    console.log('Existing settings keys:', settings.map(s => s.key));

    const payrollConfig = settings.find(s => s.key === 'payroll_config');
    if (payrollConfig) {
      const val = await db('settings').where('key', 'payroll_config').first();
      console.log('Payroll Config Value:', val.value);
    } else {
      console.warn('WARNING: payroll_config missing from settings table!');
    }

  } catch (e) {
    console.error('ERROR during check:', e.message);
  } finally {
    await db.destroy();
  }
}

check();
