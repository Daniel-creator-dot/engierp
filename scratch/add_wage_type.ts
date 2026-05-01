import knex from 'knex';

const connectionString = 'postgresql://postgres.udajgnvqizrnluldmnni:Daniel@24419000@aws-0-eu-west-1.pooler.supabase.com:5432/postgres';

const db = knex({
  client: 'postgresql',
  connection: {
    connectionString,
    ssl: { rejectUnauthorized: false }
  }
});

async function migrate() {
  try {
    const hasColumn = await db.schema.hasColumn('employees', 'wage_type');
    if (!hasColumn) {
      await db.schema.alterTable('employees', (table) => {
        table.string('wage_type', 20).defaultTo('Salaried').notNullable();
      });
      console.log('Successfully added wage_type column to employees table.');
    } else {
      console.log('wage_type column already exists.');
    }
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await db.destroy();
  }
}

migrate();
