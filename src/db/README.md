# UptimeKit Database Package

PostgreSQL schema migrations, scripts, and test suites for UptimeKit multi-tenant monitoring platform.

## Directory Layout

```text
db/
├── migrations/         # Up migrations (001_create_teams.sql - 013_enable_rls_users.sql)
│   └── down/           # Down migrations for full rollback support
├── scripts/
│   ├── migrate.ts             # Migration execution script
│   ├── partition-manager.sql  # Partition creation & retention functions
│   └── tier-query-functions.sql # Tier-routing read functions (raw, hourly, daily)
└── seeds/
    └── test-data.sql          # Seed data for dev/test testing
```

## Running Migrations

To apply forward migrations:
```bash
npm run migrate
```

To rollback:
```bash
npm run migrate down
```

## Running Tests

Unit and schema validation tests:
```bash
npm run test
```
