import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import db from './db';
import authRoutes from './routes/auth';
import hrRoutes from './routes/hr';
import accountingRoutes from './routes/accounting';
import projectsRoutes from './routes/projects';
import procurementRoutes from './routes/procurement';
import settingsRoutes from './routes/settings';
import fieldOpsRoutes from './routes/field-ops';
import contractRoutes from './routes/contracts';
import assetRoutes from './routes/assets';
import { syncSchema } from './utils/schemaSync';

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ limit: '5mb', extended: true }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/hr', hrRoutes);
app.use('/api/accounting', accountingRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/procurement', procurementRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/field-ops', fieldOpsRoutes);
app.use('/api/contracts', contractRoutes);
app.use('/api/assets', assetRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Auto-run migrations and seed on startup
async function bootstrap() {
  try {
    console.log('⏳ Running database migrations...');
    await db.migrate.latest();
    console.log('✅ Migrations complete.');

    // Run dynamic schema sync for any missing columns/tables
    await syncSchema(db);

    // Check if seed data exists (don't re-seed if users already exist)
    const existingUsers = await db('users').count('id as count').first();
    const userCount = Number(existingUsers?.count || 0);

    if (userCount === 0) {
      console.log('⏳ Seeding initial data...');
      await db.seed.run();
      console.log('✅ Seed data inserted.');
    } else {
      console.log('ℹ️  Seed skipped — data already exists.');
      
      // One-time sync: Ensure all existing users have employee records
      const usersWithoutEmp = await db('users').whereNull('employee_id').orWhere('employee_id', '');
      if (usersWithoutEmp.length > 0) {
        console.log(`⏳ Syncing ${usersWithoutEmp.length} existing users to Employee Directory...`);
        for (const user of usersWithoutEmp) {
          const staffId = `EMP-OLD-${Math.floor(1000 + Math.random() * 9000)}`;
          await db('employees').insert({
            id: staffId,
            name: user.email.split('@')[0],
            role: user.role.toUpperCase(),
            department: 'General',
            salary: 0,
            joinDate: new Date().toISOString().split('T')[0],
            status: 'active',
            phone: user.phone || ''
          });
          await db('users').where({ id: user.id }).update({ employee_id: staffId });
        }
        console.log('✅ Existing users synced.');
      }
    }

    // Ensure SMS Notify GH is the default provider
    const existingSMS = await db('sms_configurations').first();
    const defaultSMSUrl = 'https://sms.smsnotifygh.com/smsapi?key={key}&to={to}&msg={msg}&sender_id={sender}';
    const defaultSMSKey = '84c879bb-f9f9-4666-84a8-9f70a9b238cc';

    if (!existingSMS) {
      console.log('⏳ Initializing default SMS Gateway (Notify GH)...');
      await db('sms_configurations').insert({
        provider: 'Custom',
        api_url: defaultSMSUrl,
        api_key: defaultSMSKey,
        sender_id: 'BytzForge'
      });
      console.log('✅ SMS Configuration initialized.');
    } else if ((existingSMS as any).api_url && ((existingSMS as any).api_url.includes('hubtel') || (existingSMS as any).api_url === '')) {
      console.log('⏳ Updating SMS Gateway to Notify GH defaults...');
      await db('sms_configurations').where({ id: existingSMS.id }).update({
        api_url: defaultSMSUrl,
        api_key: defaultSMSKey
      });
      console.log('✅ SMS Configuration updated.');
    }
  } catch (error) {
    console.error('❌ Bootstrap error:', error);
  }
}

bootstrap().then(() => {
  app.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
  });
});

export default app;
