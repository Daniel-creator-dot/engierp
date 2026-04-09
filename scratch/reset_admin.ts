import knex from 'knex';
import bcrypt from 'bcryptjs';
import config from '../knexfile';

const db = knex(config.development);

async function resetAdmin() {
  const hashedPassword = await bcrypt.hash('Admin', 10);
  await db('users').where({ email: 'admin@engierp.com' }).update({
    password: hashedPassword
  });
  console.log('Password for admin@engierp.com has been set to: Admin');
  process.exit(0);
}

resetAdmin();
