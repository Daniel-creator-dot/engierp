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
    const columns = await db('payroll').columnInfo();
    console.log('Payroll Columns:', Object.keys(columns));
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await db.destroy();
  }
}

check();
