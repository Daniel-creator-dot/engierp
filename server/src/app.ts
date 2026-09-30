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
import usersRoutes from './routes/users';
import fieldOpsRoutes from './routes/field-ops';
import contractRoutes from './routes/contracts';
import assetRoutes from './routes/assets';
import catalogRoutes from './routes/catalog';
import dashboardRoutes from './routes/dashboard';
import auditRoutes from './routes/audit';
import notificationRoutes from './routes/notifications';
import searchRoutes from './routes/search';
import { syncSchema } from './utils/schemaSync';
import { initJwtSecret } from './lib/secrets';

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// Render (and most hosts) sit behind one proxy; needed so rate limits see the client IP.
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ limit: '5mb', extended: true }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/hr', hrRoutes);
app.use('/api/accounting', accountingRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/procurement', procurementRoutes);
app.use('/api/settings/users', usersRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/field-ops', fieldOpsRoutes);
app.use('/api/contracts', contractRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/catalog', catalogRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/search', searchRoutes);

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
    }
  } catch (error) {
    console.error('❌ Bootstrap error:', error);
  }

  await initJwtSecret();
  if (!process.env.SMS_API_KEY?.trim()) {
    console.warn('⚠️  SMS_API_KEY is not set; SMS uses the key saved in Settings, or is disabled if none is saved.');
  }
}

bootstrap().then(() => {
  app.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
  });
});

export default app;
