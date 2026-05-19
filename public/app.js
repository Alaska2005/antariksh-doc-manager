const form = document.querySelector("#event-form");
const message = document.querySelector("#form-message");
const eventsList = document.querySelector("#events-list");
const refreshButton = document.querySelector("#refresh-events");
const eventCount = document.querySelector("#event-count");
const eventSearch = document.querySelector("#event-search");
const eventDetail = document.querySelector("#event-detail");
const installBanner = document.querySelector("#install-banner");
const installButton = document.querySelector("#install-app");

let allEvents = [];
let deferredInstallPrompt = null;

function plural(count, label) {
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}

function setMessage(text, type = "") {
  message.textContent = text;
  message.className = `form-message ${type}`.trim();
}

function updateFileLabels() {
  for (const input of form.querySelectorAll('input[type="file"]')) {
    const output = form.querySelector(`[data-file-label="${input.name}"]`);
    const files = Array.from(input.files || []);
    if (!output) continue;

    if (!files.length) {
      output.textContent = input.multiple ? "No files selected" : "No file selected";
      continue;
    }

    output.textContent = input.multiple
      ? files.map((file) => file.name).join(", ")
      : files[0].name;
  }
}

function eventCard(event) {
  const reportCount = event.saved?.report?.length || 0;
  const attendanceCount = event.saved?.attendance?.length || 0;
  const photoCount = event.saved?.photos?.length || 0;

  const article = document.createElement("article");
  article.className = "event-card";
  article.innerHTML = `
    <div>
      <h3></h3>
      <p></p>
    </div>
    <div class="event-actions">
      <div class="event-counts" aria-label="Saved files">
        <span>${plural(reportCount, "report")}</span>
        <span>${plural(attendanceCount, "attendance")}</span>
        <span>${plural(photoCount, "photo")}</span>
      </div>
      <button class="secondary-button open-event" type="button">Open</button>
    </div>
  `;

  article.querySelector("h3").textContent = event.eventName;
  article.querySelector("p").textContent = `${event.eventDate} - Events/${event.eventFolderName}`;
  article.querySelector(".open-event").addEventListener("click", () => openEvent(event.eventFolderName));
  return article;
}

function filteredEvents() {
  const query = eventSearch.value.trim().toLowerCase();

  if (!query) return allEvents;

  return allEvents.filter((event) => {
    const searchable = [
      event.eventName,
      event.eventDate,
      event.eventFolderName
    ].join(" ").toLowerCase();

    return searchable.includes(query);
  });
}

function renderEvents() {
  const events = filteredEvents();
  eventCount.textContent = allEvents.length ? plural(allEvents.length, "event") : "No events yet";
  eventsList.innerHTML = "";

  if (!allEvents.length) {
    eventsList.innerHTML = '<div class="empty-state">Your uploaded event folders will appear here.</div>';
    return;
  }

  if (!events.length) {
    eventsList.innerHTML = '<div class="empty-state">No matching events found.</div>';
    return;
  }

  for (const event of events) {
    eventsList.appendChild(eventCard(event));
  }
}

async function loadEvents() {
  eventsList.innerHTML = '<div class="empty-state">Loading events...</div>';

  try {
    const response = await fetch("/api/events");
    const data = await response.json();
    allEvents = data.events || [];
    renderEvents();
  } catch {
    eventsList.innerHTML = '<div class="empty-state">Could not load events.</div>';
  }
}

function fileList(title, files) {
  const section = document.createElement("section");
  section.className = "file-section";

  const heading = document.createElement("h4");
  heading.textContent = title;
  section.appendChild(heading);

  if (!files.length) {
    const empty = document.createElement("p");
    empty.className = "muted-text";
    empty.textContent = "No files saved here.";
    section.appendChild(empty);
    return section;
  }

  const list = document.createElement("ul");
  for (const file of files) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = file.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = file.name;
    item.appendChild(link);
    list.appendChild(item);
  }

  section.appendChild(list);
  return section;
}

async function openEvent(eventFolderName) {
  eventDetail.classList.add("is-visible");
  eventDetail.innerHTML = '<div class="empty-state">Opening event...</div>';

  try {
    const response = await fetch(`/api/events/${encodeURIComponent(eventFolderName)}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not open event.");
    }

    const event = data.event;
    eventDetail.innerHTML = `
      <div class="detail-heading">
        <div>
          <p class="eyebrow">Opened event</p>
          <h2></h2>
          <p></p>
        </div>
        <button class="secondary-button" type="button" id="close-detail">Close</button>
      </div>
      <div class="file-grid"></div>
    `;

    eventDetail.querySelector("h2").textContent = event.eventName;
    eventDetail.querySelector(".detail-heading p:last-child").textContent = `${event.eventDate} - Events/${event.eventFolderName}`;
    eventDetail.querySelector("#close-detail").addEventListener("click", () => {
      eventDetail.classList.remove("is-visible");
      eventDetail.innerHTML = "";
    });

    const fileGrid = eventDetail.querySelector(".file-grid");
    fileGrid.appendChild(fileList("Report", event.files.report));
    fileGrid.appendChild(fileList("Attendance", event.files.attendance));
    fileGrid.appendChild(fileList("Photos", event.files.photos));
    eventDetail.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    eventDetail.innerHTML = `<div class="empty-state">${error.message}</div>`;
  }
}

form.addEventListener("change", updateFileLabels);

form.addEventListener("reset", () => {
  setTimeout(updateFileLabels, 0);
  setMessage("");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = form.querySelector('button[type="submit"]');
  const formData = new FormData(form);

  setMessage("Saving event files...");
  submitButton.disabled = true;

  try {
    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Upload failed.");
    }

    form.reset();
    updateFileLabels();
    setMessage(`Saved to Events/${data.event.eventFolderName}`, "success");
    await loadEvents();
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    submitButton.disabled = false;
  }
});

refreshButton.addEventListener("click", loadEvents);
eventSearch.addEventListener("input", renderEvents);
loadEvents();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js");
  });
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installBanner.hidden = false;
});

installButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;

  installBanner.hidden = true;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
});

window.addEventListener("appinstalled", () => {
  installBanner.hidden = true;
  deferredInstallPrompt = null;
});
