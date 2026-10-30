# TwinEval deployment: Vercel + Render + Supabase

TwinEval's local-AI deployment uses three pieces:

- Vercel: static browser frontend
- Render `twineval-api`: Node/Express API
- Supabase: PostgreSQL database and persistent uploaded-file storage

AI/OCR runs on each user's Windows computer through `start-ai-windows.bat`
and local Ollama at `http://127.0.0.1:8000`.

## 1. Create Supabase resources

1. Create a Supabase project.
  2. In **Storage**, create a public bucket named `twineval-uploads`.
3. Copy these values from Supabase project settings:
   - PostgreSQL connection string (use the session pooler string if direct IPv6 is unavailable)
   - Project URL
   - `service_role` key (server secret; never put this in Vercel or browser code)

## 2. Deploy the Render API

In Render choose **New > Blueprint**, connect the GitHub repository, and use
the root `render.yaml`. Enter the requested secret values:

### `twineval-api`

- `DATABASE_URL`: Supabase PostgreSQL connection string
- `SUPABASE_URL`: Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service-role key
- `PUBLIC_APP_URL`: the final Vercel URL (it can be corrected after Vercel deploys)
- `GOOGLE_CLIENT_ID`: Google OAuth Web Client ID
- `SMTP_USER`: Gmail sender address
- `SMTP_PASS`: Gmail App Password
- `SMTP_FROM`: for example `TwinEval AI <twinevallogin@gmail.com>`
- `AI_SERVICE_URL`: public Render AI URL, for example `https://twineval-ai.onrender.com`

Confirm that `/health` returns JSON on the Render API URL. The existing
`twineval-ai` Render service can be suspended because the browser no longer
uses it.

## 4. Deploy the frontend to Vercel

Import the same GitHub repository into Vercel. `vercel.json` supplies the build
command and output folder. Add these build environment variables:

- `TWINEVAL_API_BASE=https://twineval-api.onrender.com`

No hosted AI URL is required; the build fixes AI requests to
`http://127.0.0.1:8000`.

Deploy, then copy the final Vercel URL back into Render as `PUBLIC_APP_URL`.

## 5. Start AI on every client computer

Install Ollama, then run `start-ai-windows.bat` from the TwinEval project on
each computer that will generate papers or evaluate answers. Confirm
`http://127.0.0.1:8000/health` opens before using an AI workflow.

## 6. Update Google OAuth

In Google Cloud Console, open the OAuth Web Client and add the exact Vercel
origin under **Authorized JavaScript origins**, such as:

`https://twineval-ai.vercel.app`

Also keep `http://localhost:5000` for local development. If the OAuth consent
screen is in Testing mode, add each allowed Google account as a test user;
publish the consent screen when the application is ready for general access.

## Important

- Never commit `.env`, Gmail App Passwords, the Gemini key, database passwords,
  or the Supabase service-role key.
- Render free services can sleep when idle, so the first request may be slow.
- The Supabase bucket must be public for saved avatar/document URLs to open
  directly. Upload authority still remains server-only through the service key.
