# SQLite Schema

- `schema.sql` is the active SQLite schema used by the application.
- There is intentionally no SQLite seed file in the portable distribution.
- Real application data is imported from the user's existing MySQL SQL dump with `npm run import:mysql`.

The legacy MySQL schema and migration files remain under `docs/legacy/mysql/` as references for the one-time migration and historical documentation.
