# SQLite Database

TwinEval AI Portable uses a local SQLite database stored at:

```text
database/twineval.db
```

## Important: no demo data

The portable build does **not** create demonstration users, sample students, fake evaluations, or other sample records.

On first startup, TwinEval AI creates only the database schema. Your real records must be imported from your existing MySQL database.

## Import your existing MySQL data

1. Export the existing `twineval_ai` database from MySQL as a self-contained `.sql` dump.
2. Put the dump anywhere convenient; it does not need to be committed to GitHub.
3. From the project root run:

```bash
npm install
npm run setup
npm run import:mysql -- /path/to/twineval_ai.sql
```

Windows example:

```bat
npm run import:mysql -- "C:\Users\YourName\Desktop\twineval_ai.sql"
```

macOS example:

```bash
npm run import:mysql -- "$HOME/Desktop/twineval_ai.sql"
```

The importer reads the data from the SQL dump and writes it into `database/twineval.db` while preserving explicit primary-key IDs and the supported TwinEval tables.

### Safety behavior

The importer refuses to run when the target SQLite database already contains records. This prevents accidental merging or overwriting of real data.

Back up `database/twineval.db` before making future schema changes.
