
import knex from 'knex';

const connectionString = 'postgresql://postgres.rjihjzsjbsalkyjghfjl:Daniel@24419000@aws-1-us-west-1.pooler.supabase.com:5432/postgres';

const db = knex({
  client: 'postgresql',
  connection: {
    connectionString,
    ssl: { rejectUnauthorized: false }
  }
});

async function check() {
  try {
    console.log('Testing with Knex and original connection string...');
    const users = await db('users').select('email', 'password', 'role');
    console.log('SUCCESS');
    console.log('Online Users:', JSON.stringify(users, null, 2));
  } catch (e) {
    console.error('FAILED:', e.message);
  } finally {
    await db.destroy();
  }
}

check();
