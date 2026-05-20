# Antariksh Doc Manager

Antariksh Doc Manager is a space-themed document archive for Antariksh Club events. It lets club members upload an event report, attendance sheet, photos, event name, and event date, then organizes everything into event-specific folders or Supabase storage.

## Features

- Upload report, attendance sheet, and multiple event photos.
- Store files by event date and event name.
- Search events by name, date, or folder name.
- Open an event to view its report, attendance, and photo files.
- Installable PWA with app icon and full-screen mobile experience.
- Local filesystem mode for development.
- Supabase database/storage mode for deployment.

## Local Folder Structure

When running without Supabase environment variables, uploads are saved locally:

```text
Events/
  YYYY-MM-DD_event-name/
    Report/
    Attendance/
    Photos/
    event.json
```

## Tech Stack

- Node.js HTTP server
- Plain HTML, CSS, and JavaScript
- Progressive Web App manifest and service worker
- Optional Supabase Postgres + Supabase Storage backend

## Run Locally

Install dependencies:

```bash
npm install
```

Start the app:

```bash
npm start
```

Open:

```text
http://localhost:3000
```

## Environment Variables

The app works locally without any environment variables. For production with Supabase, set:

```text
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
SUPABASE_BUCKET=event-files
```

Optional local storage path:

```text
EVENTS_DIR=/path/to/local/events
```

Important: never expose `SUPABASE_SERVICE_ROLE_KEY` in frontend code or public pages.

## Supabase Setup

1. Create a Supabase project.
2. Open the SQL Editor.
3. Run the SQL from `supabase-schema.sql`.
4. Copy your Project URL and service role key.
5. Add them as environment variables on your server host.

## PWA Install

After hosting on HTTPS:

- Android Chrome: open the site, then choose **Install app** or **Add to Home screen**.
- iPhone Safari: open the site, tap Share, then choose **Add to Home Screen**.

The app includes:

- `public/manifest.json`
- `public/service-worker.js`
- app icons in `public/icons/`

## Deployment Notes

This app needs persistent file storage. Free platforms that reset the filesystem are not safe for uploads unless Supabase Storage is used.

Recommended deployment patterns:

- Render Node web service + Supabase database/storage
- Static frontend + direct Supabase client upload, if the backend is rewritten for public `anon` key and strict Row Level Security
- VPS or always-free VM for full server control

## Repository Safety

Uploaded event files are ignored by Git:

```text
Events/
storage/
```

This keeps reports, attendance sheets, and photos out of the public repository.
