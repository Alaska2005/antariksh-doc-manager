const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const { existsSync } = require("fs");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const EVENTS_DIR = process.env.EVENTS_DIR || path.join(ROOT, "Events");
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "event-files";
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".csv": "text/csv; charset=utf-8",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
};

const CATEGORY_DIRECTORIES = {
  report: "Report",
  attendance: "Attendance",
  photos: "Photos"
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70) || "event";
}

function safeName(filename) {
  const parsed = path.parse(filename || "upload");
  const name = slugify(parsed.name);
  const ext = parsed.ext.toLowerCase().replace(/[^a-z0-9.]/g, "");
  return `${name}${ext}`;
}

function parseDisposition(value) {
  const result = {};
  for (const part of value.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (!rest.length) continue;
    result[rawKey.toLowerCase()] = rest.join("=").trim().replace(/^"|"$/g, "");
  }
  return result;
}

function splitBuffer(buffer, delimiter) {
  const chunks = [];
  let start = 0;
  let index = buffer.indexOf(delimiter, start);

  while (index !== -1) {
    chunks.push(buffer.subarray(start, index));
    start = index + delimiter.length;
    index = buffer.indexOf(delimiter, start);
  }

  chunks.push(buffer.subarray(start));
  return chunks;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function parseMultipart(req) {
  const contentType = req.headers["content-type"] || "";
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);

  if (!boundaryMatch) {
    throw new Error("Missing multipart boundary.");
  }

  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const body = await readBody(req);
  const fields = {};
  const files = {};

  for (const rawPart of splitBuffer(body, boundary)) {
    let part = rawPart;
    if (part.length === 0 || part.equals(Buffer.from("--\r\n")) || part.equals(Buffer.from("--"))) continue;

    if (part.subarray(0, 2).toString() === "\r\n") part = part.subarray(2);
    if (part.subarray(part.length - 2).toString() === "\r\n") part = part.subarray(0, part.length - 2);
    if (part.subarray(part.length - 2).toString() === "--") part = part.subarray(0, part.length - 2);

    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd === -1) continue;

    const headerText = part.subarray(0, headerEnd).toString("latin1");
    const content = part.subarray(headerEnd + 4);
    const headers = Object.fromEntries(
      headerText.split("\r\n").map((line) => {
        const separator = line.indexOf(":");
        return [line.slice(0, separator).toLowerCase(), line.slice(separator + 1).trim()];
      })
    );

    const disposition = parseDisposition(headers["content-disposition"] || "");
    const fieldName = disposition.name;
    if (!fieldName) continue;

    if (disposition.filename) {
      if (!content.length) continue;
      files[fieldName] = files[fieldName] || [];
      files[fieldName].push({
        originalName: disposition.filename,
        filename: safeName(disposition.filename),
        type: headers["content-type"] || "application/octet-stream",
        content
      });
    } else {
      fields[fieldName] = content.toString("utf8").trim();
    }
  }

  return { fields, files };
}

function safeEventFolderName(value) {
  const decoded = decodeURIComponent(value || "");
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}_[a-z0-9-]+$/.test(decoded) ? decoded : null;
}

function categoryDirectory(category) {
  return CATEGORY_DIRECTORIES[category] || null;
}

function emptySaved() {
  return { report: [], attendance: [], photos: [] };
}

function filesToSaved(files) {
  const saved = emptySaved();
  for (const file of files) {
    if (saved[file.category]) saved[file.category].push(file.file_name);
  }
  return saved;
}

function filesToPublicShape(eventFolderName, files) {
  const shaped = { report: [], attendance: [], photos: [] };
  for (const file of files) {
    if (!shaped[file.category]) continue;
    shaped[file.category].push({
      name: file.file_name,
      url: `/api/files/${encodeURIComponent(eventFolderName)}/${file.category}/${encodeURIComponent(file.file_name)}`
    });
  }
  return shaped;
}

function eventToPublicShape(event, files = []) {
  return {
    eventName: event.event_name,
    eventDate: event.event_date,
    eventFolderName: event.folder_name,
    saved: filesToSaved(files),
    updatedAt: event.updated_at || event.created_at || null
  };
}

function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra
  };
}

async function supabaseRequest(endpoint, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${endpoint}`, {
    ...options,
    headers: supabaseHeaders(options.headers || {})
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof payload === "string" ? payload : payload.message || payload.error || JSON.stringify(payload);
    throw new Error(`Supabase request failed: ${message}`);
  }

  return payload;
}

async function upsertSupabaseEvent(eventName, eventDate, eventFolderName) {
  const rows = await supabaseRequest("/rest/v1/events?on_conflict=folder_name", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify([{
      event_name: eventName,
      event_date: eventDate,
      folder_name: eventFolderName,
      updated_at: new Date().toISOString()
    }])
  });

  return rows[0];
}

async function listSupabaseFiles(eventId) {
  return supabaseRequest(`/rest/v1/event_files?event_id=eq.${encodeURIComponent(eventId)}&select=*&order=category.asc,file_name.asc`);
}

function uniqueNameForExisting(filename, existingNames) {
  const parsed = path.parse(filename);
  let candidate = filename;
  let counter = 1;

  while (existingNames.has(candidate)) {
    candidate = `${parsed.name}-${counter}${parsed.ext}`;
    counter += 1;
  }

  existingNames.add(candidate);
  return candidate;
}

async function uploadSupabaseFile(storagePath, file) {
  await supabaseRequest(`/storage/v1/object/${SUPABASE_BUCKET}/${storagePath.split("/").map(encodeURIComponent).join("/")}`, {
    method: "POST",
    headers: {
      "Content-Type": file.type,
      "x-upsert": "false"
    },
    body: file.content
  });
}

async function saveSupabaseFiles(event, eventFolderName, category, uploadFiles = []) {
  const existingFiles = await listSupabaseFiles(event.id);
  const existingNames = new Set(existingFiles.filter((file) => file.category === category).map((file) => file.file_name));
  const rows = [];

  for (const file of uploadFiles) {
    const fileName = uniqueNameForExisting(file.filename, existingNames);
    const storagePath = `${eventFolderName}/${categoryDirectory(category)}/${fileName}`;
    await uploadSupabaseFile(storagePath, file);
    rows.push({
      event_id: event.id,
      category,
      file_name: fileName,
      storage_path: storagePath,
      mime_type: file.type
    });
  }

  if (!rows.length) return [];

  return supabaseRequest("/rest/v1/event_files", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify(rows)
  });
}

async function handleSupabaseUpload(eventName, eventDate, files) {
  const eventFolderName = `${eventDate}_${slugify(eventName)}`;
  const event = await upsertSupabaseEvent(eventName, eventDate, eventFolderName);

  await saveSupabaseFiles(event, eventFolderName, "report", files.report);
  await saveSupabaseFiles(event, eventFolderName, "attendance", files.attendance);
  await saveSupabaseFiles(event, eventFolderName, "photos", files.photos);

  const savedFiles = await listSupabaseFiles(event.id);
  return eventToPublicShape(event, savedFiles);
}

async function listSupabaseEvents(res) {
  const events = await supabaseRequest("/rest/v1/events?select=*&order=event_date.desc,created_at.desc");
  const eventIds = events.map((event) => event.id);
  let files = [];

  if (eventIds.length) {
    files = await supabaseRequest(`/rest/v1/event_files?event_id=in.(${eventIds.join(",")})&select=*&order=category.asc,file_name.asc`);
  }

  const filesByEvent = new Map();
  for (const file of files) {
    filesByEvent.set(file.event_id, [...(filesByEvent.get(file.event_id) || []), file]);
  }

  sendJson(res, 200, {
    events: events.map((event) => eventToPublicShape(event, filesByEvent.get(event.id) || []))
  });
}

async function getSupabaseEventByFolder(eventFolderName) {
  const rows = await supabaseRequest(`/rest/v1/events?folder_name=eq.${encodeURIComponent(eventFolderName)}&select=*&limit=1`);
  return rows[0] || null;
}

async function getSupabaseEventDetails(res, eventFolderName) {
  const safeFolderName = safeEventFolderName(eventFolderName);
  if (!safeFolderName) {
    sendJson(res, 400, { error: "Invalid event folder." });
    return;
  }

  const event = await getSupabaseEventByFolder(safeFolderName);
  if (!event) {
    sendJson(res, 404, { error: "Event not found." });
    return;
  }

  const files = await listSupabaseFiles(event.id);
  sendJson(res, 200, {
    event: {
      ...eventToPublicShape(event, files),
      files: filesToPublicShape(safeFolderName, files)
    }
  });
}

async function serveSupabaseEventFile(res, eventFolderName, category, filename) {
  const safeFolderName = safeEventFolderName(eventFolderName);
  const directoryName = categoryDirectory(category);
  const safeFilename = path.basename(decodeURIComponent(filename || ""));

  if (!safeFolderName || !directoryName || !safeFilename) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Invalid file request");
    return;
  }

  const event = await getSupabaseEventByFolder(safeFolderName);
  if (!event) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Event not found");
    return;
  }

  const rows = await supabaseRequest(
    `/rest/v1/event_files?event_id=eq.${encodeURIComponent(event.id)}&category=eq.${encodeURIComponent(category)}&file_name=eq.${encodeURIComponent(safeFilename)}&select=*&limit=1`
  );
  const file = rows[0];

  if (!file) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("File not found");
    return;
  }

  const signed = await supabaseRequest(`/storage/v1/object/sign/${SUPABASE_BUCKET}/${file.storage_path.split("/").map(encodeURIComponent).join("/")}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 300 })
  });

  res.writeHead(302, { Location: `${SUPABASE_URL}/storage/v1${signed.signedURL}` });
  res.end();
}

async function uniqueFilePath(directory, filename) {
  const parsed = path.parse(filename);
  let candidate = path.join(directory, filename);
  let counter = 1;

  while (existsSync(candidate)) {
    candidate = path.join(directory, `${parsed.name}-${counter}${parsed.ext}`);
    counter += 1;
  }

  return candidate;
}

async function saveLocalFiles(directory, uploadFiles = []) {
  await fs.mkdir(directory, { recursive: true });
  const saved = [];

  for (const file of uploadFiles) {
    const target = await uniqueFilePath(directory, file.filename);
    await fs.writeFile(target, file.content);
    saved.push(path.basename(target));
  }

  return saved;
}

async function handleLocalUpload(eventName, eventDate, files) {
  const eventFolderName = `${eventDate}_${slugify(eventName)}`;
  const eventDir = path.join(EVENTS_DIR, eventFolderName);
  const reportDir = path.join(eventDir, "Report");
  const attendanceDir = path.join(eventDir, "Attendance");
  const photosDir = path.join(eventDir, "Photos");

  await fs.mkdir(eventDir, { recursive: true });

  const saved = {
    report: await saveLocalFiles(reportDir, files.report),
    attendance: await saveLocalFiles(attendanceDir, files.attendance),
    photos: await saveLocalFiles(photosDir, files.photos)
  };

  const metadata = {
    eventName,
    eventDate,
    eventFolderName,
    saved,
    updatedAt: new Date().toISOString()
  };

  await fs.writeFile(path.join(eventDir, "event.json"), JSON.stringify(metadata, null, 2));
  return metadata;
}

async function handleUpload(req, res) {
  try {
    const { fields, files } = await parseMultipart(req);
    const eventName = fields.eventName || "";
    const eventDate = fields.eventDate || "";

    if (!eventName || !eventDate) {
      sendJson(res, 400, { error: "Event name and date are required." });
      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
      sendJson(res, 400, { error: "Use a valid event date." });
      return;
    }

    const event = USE_SUPABASE
      ? await handleSupabaseUpload(eventName, eventDate, files)
      : await handleLocalUpload(eventName, eventDate, files);

    sendJson(res, 201, {
      message: "Event documents saved.",
      event
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Upload failed." });
  }
}

async function readLocalEventMetadata(eventFolderName) {
  const eventDir = path.join(EVENTS_DIR, eventFolderName);
  const metadataPath = path.join(eventDir, "event.json");

  try {
    return JSON.parse(await fs.readFile(metadataPath, "utf8"));
  } catch {
    return {
      eventName: eventFolderName.replace(/^\d{4}-\d{2}-\d{2}_/, "").replace(/-/g, " "),
      eventDate: eventFolderName.slice(0, 10),
      eventFolderName,
      saved: emptySaved(),
      updatedAt: null
    };
  }
}

async function listLocalEvents(res) {
  await fs.mkdir(EVENTS_DIR, { recursive: true });
  const entries = await fs.readdir(EVENTS_DIR, { withFileTypes: true });
  const events = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    events.push(await readLocalEventMetadata(entry.name));
  }

  events.sort((a, b) => `${b.eventDate}`.localeCompare(`${a.eventDate}`));
  sendJson(res, 200, { events });
}

async function localFilesForCategory(eventFolderName, category) {
  const directoryName = categoryDirectory(category);
  if (!directoryName) return [];

  const directory = path.join(EVENTS_DIR, eventFolderName, directoryName);

  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => ({
        name: entry.name,
        url: `/api/files/${encodeURIComponent(eventFolderName)}/${category}/${encodeURIComponent(entry.name)}`
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

async function getLocalEventDetails(res, eventFolderName) {
  const safeFolderName = safeEventFolderName(eventFolderName);

  if (!safeFolderName) {
    sendJson(res, 400, { error: "Invalid event folder." });
    return;
  }

  const eventDir = path.join(EVENTS_DIR, safeFolderName);
  if (!existsSync(eventDir)) {
    sendJson(res, 404, { error: "Event not found." });
    return;
  }

  const metadata = await readLocalEventMetadata(safeFolderName);
  const files = {
    report: await localFilesForCategory(safeFolderName, "report"),
    attendance: await localFilesForCategory(safeFolderName, "attendance"),
    photos: await localFilesForCategory(safeFolderName, "photos")
  };

  sendJson(res, 200, { event: { ...metadata, files } });
}

async function serveLocalEventFile(res, eventFolderName, category, filename) {
  const safeFolderName = safeEventFolderName(eventFolderName);
  const directoryName = categoryDirectory(category);
  const safeFilename = path.basename(decodeURIComponent(filename || ""));

  if (!safeFolderName || !directoryName || !safeFilename) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Invalid file request");
    return;
  }

  const baseDir = path.join(EVENTS_DIR, safeFolderName, directoryName);
  const filePath = path.join(baseDir, safeFilename);

  if (!filePath.startsWith(baseDir)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Content-Disposition": `inline; filename="${safeFilename.replace(/"/g, "")}"`
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("File not found");
  }
}

async function listEvents(res) {
  if (USE_SUPABASE) {
    await listSupabaseEvents(res);
    return;
  }

  await listLocalEvents(res);
}

async function getEventDetails(res, eventFolderName) {
  if (USE_SUPABASE) {
    await getSupabaseEventDetails(res, eventFolderName);
    return;
  }

  await getLocalEventDetails(res, eventFolderName);
}

async function serveEventFile(res, eventFolderName, category, filename) {
  if (USE_SUPABASE) {
    await serveSupabaseEventFile(res, eventFolderName, category, filename);
    return;
  }

  await serveLocalEventFile(res, eventFolderName, category, filename);
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const normalizedPath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, normalizedPath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream"
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "POST" && url.pathname === "/api/upload") {
    await handleUpload(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/events") {
    await listEvents(res);
    return;
  }

  const eventMatch = url.pathname.match(/^\/api\/events\/([^/]+)$/);
  if (req.method === "GET" && eventMatch) {
    await getEventDetails(res, eventMatch[1]);
    return;
  }

  const fileMatch = url.pathname.match(/^\/api\/files\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (req.method === "GET" && fileMatch) {
    await serveEventFile(res, fileMatch[1], fileMatch[2], fileMatch[3]);
    return;
  }

  if (req.method === "GET") {
    await serveStatic(req, res);
    return;
  }

  res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Method not allowed");
});

server.listen(PORT, () => {
  console.log(`Antariksh Doc Manager running at http://localhost:${PORT}`);
  console.log(USE_SUPABASE
    ? `Using Supabase bucket "${SUPABASE_BUCKET}" for event files`
    : `Files will be organized inside ${EVENTS_DIR}`);
});
