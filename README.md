# bytzforge ERP

Construction ERP for Ghana-based contractors: accounting (GL, AR/AP, bank, reports), HR & payroll (PAYE/SSNIT), projects and job costing, procurement, field operations and fixed assets.

- **Frontend:** React 19 + Vite + TypeScript + Tailwind (`src/`)
- **Backend:** Express + Knex on PostgreSQL (`server/src/`), run with `tsx`
- **Database:** PostgreSQL (production runs on Supabase). Migrations in `server/migrations/` run automatically when the API starts.

## Local setup

Prerequisites: Node.js 20+, a PostgreSQL database.

```bash
npm install
cp .env.example .env        # then fill in the values
npm run server:dev          # API on http://localhost:5000 (restarts on change)
npm run dev                 # web app on http://localhost:3000
```

Without `NODE_ENV=production`, the API uses the `development` connection in `knexfile.ts` (local database `eng`). Set `NODE_ENV=production` and `DATABASE_URL` to use a hosted database instead.

On an empty database the API seeds demo data including `admin@engierp.com`; that account must change its password at first sign-in.

Checks to run before pushing (main auto-deploys):

```bash
npx tsc --noEmit            # typechecks frontend and server
npm run build               # production frontend build
```

## Environment variables

| Variable | Where | Required | Purpose |
|---|---|---|---|
| `DATABASE_URL` | API | Yes (production) | Postgres connection string. Used when `NODE_ENV=production`. |
| `NODE_ENV` | API | Yes (production) | Set to `production` on the host. |
| `JWT_SECRET` | API | Strongly recommended | Signs login sessions. Use 32+ random characters (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`). If unset, the API falls back to a random secret stored in the `app_secrets` table and logs a warning. Changing it signs everyone out. |
| `SMS_API_KEY` | API | For SMS | SMS gateway key (Intek SMS by default). Without it (and without a key saved in Settings → SMS Gateway), SMS is disabled: forgot-password is unavailable and alerts are in-app only. Set it on the host only; never commit it. |
| `SMS_PROVIDER` | API | Optional | `intek` (default), `hubtel`, `twilio` or `custom`. Overrides the provider saved in Settings. |
| `SMS_SENDER_ID` | API | For SMS | Approved sender ID on the provider account. Overrides the one saved in Settings. |
| `SMS_API_URL` | API | Optional | Intek base URL (default `https://www.inteksms.top/api/v1`), or for `custom` a URL template with placeholders `{key}`, `{to}`, `{msg}`, `{sender}`, `{secret}`. Overrides the URL saved in Settings. |
| `SMS_API_SECRET` | API | Optional | Only for providers that need a secret (Hubtel, Twilio). |
| `PORT` | API | Set by host | Port to listen on (default 5000). |
| `VITE_API_URL` | Web build | Yes (production) | Public URL of the API, e.g. `https://your-api.onrender.com/api`. `/api` is appended if missing. Read at build time. |

## Deploying

The API and the web app deploy separately.

**API (e.g. a Render web service)**
- Build command: `npm install`
- Start command: `npm run server`
- Env: `NODE_ENV=production`, `DATABASE_URL`, `JWT_SECRET`, `SMS_API_KEY`, `SMS_SENDER_ID`, `SMS_API_URL`, `SMS_PROVIDER`
- SMS check: Settings → SMS Gateway shows the provider, key status, sender ID approval and balance (read-only), and has a "Send test" button for admins.
- Health check: `GET /health`
- Migrations run on every start; add new ones as `server/migrations/<timestamp>_<name>.ts`. Never change the production schema by hand.

**Web app (static site)**
- Build command: `npm install && npm run build`
- Publish directory: `dist`
- Env: `VITE_API_URL`

## Roles

| Role | Access |
|---|---|
| `admin` | Everything, including user management, SMS gateway, branding, audit log, payroll and leave approval. |
| `accountant` | Accounting, projects, procurement, assets; employee directory and payroll; company profile and tax settings; categories & services. |
| `hr` | HR (directory, payroll preparation, leave), projects; can create non-admin users. |
| `pm` | Projects, field operations; own payslips and leave. |
| `procurement` | Procurement (POs, inventory, suppliers); own payslips and leave. |

Every user has a Profile page with their payslips, leave requests, profile details and password change.

## Security notes

- New users and admin password resets get a random temporary password, shown once to the admin (and sent by SMS when configured). The user must choose a new password at first sign-in.
- Accounts lock for 15 minutes after 5 failed sign-ins; login, forgot-password and reset endpoints are rate limited per IP.
- Reset codes are 6 digits, valid for 10 minutes, stored hashed, and invalidated after 5 wrong attempts. They are only ever sent by SMS.
- Deactivating a user, changing their role or resetting their password takes effect within about 30 seconds, without waiting for their session to expire.
- Sign-ins, user changes and settings changes are written to the audit log (Settings → Audit Log). Server code can record its own events with `logAudit()` from `server/src/lib/audit.ts`, and send in-app/SMS notifications with `notify()` from `server/src/lib/notify.ts`.
- Anything interpolated into print windows must go through `escapeHtml()` from `src/lib/html.ts`.
