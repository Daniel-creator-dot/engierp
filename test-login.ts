import bcrypt from 'bcryptjs';
import knex from 'knex';
import config from './knexfile';
const db = knex((config as any).development);

async function run() {
  try {
    const newHash = await bcrypt.hash('password123', 10);
    const users = await db('users').select('id', 'email');
    
    for (const user of users) {
      await db('users').where({ id: user.id }).update({ password: newHash });
      console.log(`✅ Reset password for: ${user.email}`);
    }
    
    console.log('\nAll accounts now use password: password123');
  } catch(e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();
