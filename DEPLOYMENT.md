# Antariksh Docs Deployment

This app is a Node.js web service and PWA. It needs persistent storage because uploaded reports, attendance sheets, and photos are saved to disk.

## Recommended: Render

1. Push this project to GitHub.
2. In Render, create a new Blueprint or Web Service from the GitHub repo.
3. Use these settings if creating manually:
   - Build command: `npm install`
   - Start command: `npm start`
   - Environment variable: `EVENTS_DIR=/opt/render/project/src/storage/Events`
4. Add a persistent disk:
   - Name: `antariksh-event-storage`
   - Mount path: `/opt/render/project/src/storage`
   - Size: `1 GB` or larger
5. Deploy.

After deployment, users can open the HTTPS URL in Chrome or Safari and use Add to Home Screen.

## Important

Do not rely on the default server filesystem for uploads in production. Use the persistent disk path from `EVENTS_DIR`; otherwise uploaded files can disappear during redeploys or host restarts.

## Local Run

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```
