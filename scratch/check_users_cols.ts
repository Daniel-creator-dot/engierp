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
    const columns = await db('information_schema.columns')
      .where({ table_name: 'users' })
      .select('column_name');
    console.log('Columns in users table:', columns.map(c => c.column_name));
  } catch (e) {
    console.error('ERROR:', e.message);
  } finally {
    await db.destroy();
  }
}

check();
