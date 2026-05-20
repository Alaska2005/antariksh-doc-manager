# Antariksh Docs Deployment

This app is a Node.js web service and PWA. For production deployment, use Render for the app and Supabase for the database and uploaded files.

## Recommended Stack: Render + Supabase

### 1. Create Supabase project

1. Go to Supabase and create a new project.
2. Open SQL Editor.
3. Run the contents of `supabase-schema.sql`.
4. Open Project Settings > API.
5. Copy:
   - Project URL
   - service_role key

Keep the service role key private. It belongs only in Render environment variables.

### 2. Deploy app on Render

1. Push this repo to GitHub.
2. In Render, create a new Blueprint or Web Service from GitHub.
3. Select this repository.
4. Use:
   - Build command: `npm install`
   - Run command: `npm start`
   - Port: `3000`
5. Add environment variables in Render:
   - `SUPABASE_URL=your_supabase_project_url`
   - `SUPABASE_SERVICE_ROLE_KEY=your_service_role_key`
   - `SUPABASE_BUCKET=event-files`
6. Deploy.

Render gives you an HTTPS URL. Open that URL on mobile and use Add to Home Screen.

## How Storage Works

Local development without Supabase env vars still saves files inside `Events/`.

Production with Supabase env vars saves:

```text
Supabase Postgres:
events
event_files

Supabase Storage:
event-files/
  YYYY-MM-DD_event-name/
    Report/
    Attendance/
    Photos/
```

## Local Run

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

## Local Supabase Test

Create a `.env` file or set these variables in your shell:

```text
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_BUCKET=event-files
```

Then run:

```bash
npm start
```
