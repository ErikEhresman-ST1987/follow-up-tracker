(function () {
  "use strict";

  const DATA_VERSION = 1;
  const BACKUP_FORMAT_VERSION = 1;
  const STORAGE_KEY = "followUpTracker.appData";
  const VALID_SCREENS = new Set(["home", "contacts", "studies", "report", "data"]);

  let appState = createDefaultState();
  let activeScreen = "home";
  let contactEditor = null;
  let activeContactId = null;
  let interactionEditor = null;
  let pauseEditor = false;
  let showPausedOnly = false;
  let contactSearchQuery = "";
  let studyLifecycleEditor = null;
  let reportMonth = currentMonthValue();
  let pendingRestore = null;
  let restoreMessage = "";
  let restoreMessageType = "";

  const mainElement = document.querySelector("#main-content");
  const saveStatusElement = document.querySelector("#save-status");
  const navigationElement = document.querySelector(".app-nav");

  function createDefaultState() {
    return { dataVersion: DATA_VERSION, settings: {}, contacts: [] };
  }

  function createId(prefix) {
    if (crypto.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  function createContact(values) {
    const now = new Date().toISOString();
    return {
      id: createId("contact"),
      name: values.name,
      address: values.address,
      phone: values.phone,
      email: values.email,
      generalNote: values.generalNote,
      relationshipType: "followUp",
      followUp: { normalIntervalDays: null, specificDate: "", specificTime: "" },
      pause: { status: "active", untilDate: "", reason: "" },
      bibleStudy: {
        isActive: false,
        normalDay: "",
        normalTime: "",
        location: "",
        publication: "",
        progress: "",
        specificDate: "",
        specificTime: ""
      },
      history: [],
      createdAt: now,
      updatedAt: now
    };
  }

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function textOrEmpty(value) {
    return typeof value === "string" ? value : "";
  }

  function normalizeHistoryEntry(candidate) {
    if (!isPlainObject(candidate)) return null;
    const allowedTypes = ["successfulContact", "attemptedContact", "conductedStudy", "missedStudy"];
    return {
      ...candidate,
      id: typeof candidate.id === "string" && candidate.id ? candidate.id : createId("history"),
      type: allowedTypes.includes(candidate.type) ? candidate.type : "attemptedContact",
      date: textOrEmpty(candidate.date),
      time: textOrEmpty(candidate.time),
      discussionNotes: textOrEmpty(candidate.discussionNotes),
      scriptures: textOrEmpty(candidate.scriptures),
      literature: textOrEmpty(candidate.literature),
      note: textOrEmpty(candidate.note),
      studyProgress: textOrEmpty(candidate.studyProgress),
      createdAt: textOrEmpty(candidate.createdAt),
      updatedAt: textOrEmpty(candidate.updatedAt)
    };
  }

  function normalizeContact(candidate) {
    if (!isPlainObject(candidate)) return null;

    const followUp = isPlainObject(candidate.followUp) ? candidate.followUp : {};
    const pause = isPlainObject(candidate.pause) ? candidate.pause : {};
    const bibleStudy = isPlainObject(candidate.bibleStudy) ? candidate.bibleStudy : {};

    return {
      ...candidate,
      id: typeof candidate.id === "string" && candidate.id ? candidate.id : createId("contact"),
      name: typeof candidate.name === "string" && candidate.name.trim() ? candidate.name.trim() : "Unnamed contact",
      address: textOrEmpty(candidate.address),
      phone: textOrEmpty(candidate.phone),
      email: textOrEmpty(candidate.email),
      generalNote: textOrEmpty(candidate.generalNote),
      relationshipType: candidate.relationshipType === "bibleStudy" ? "bibleStudy" : "followUp",
      followUp: {
        ...followUp,
        normalIntervalDays: Number.isInteger(followUp.normalIntervalDays) ? followUp.normalIntervalDays : null,
        specificDate: textOrEmpty(followUp.specificDate),
        specificTime: textOrEmpty(followUp.specificTime)
      },
      pause: {
        ...pause,
        status: ["active", "untilDate", "indefinite"].includes(pause.status) ? pause.status : "active",
        untilDate: textOrEmpty(pause.untilDate),
        reason: textOrEmpty(pause.reason)
      },
      bibleStudy: {
        ...bibleStudy,
        isActive: bibleStudy.isActive === true,
        normalDay: textOrEmpty(bibleStudy.normalDay),
        normalTime: textOrEmpty(bibleStudy.normalTime),
        location: textOrEmpty(bibleStudy.location),
        publication: textOrEmpty(bibleStudy.publication),
        progress: textOrEmpty(bibleStudy.progress),
        specificDate: textOrEmpty(bibleStudy.specificDate),
        specificTime: textOrEmpty(bibleStudy.specificTime)
      },
      history: Array.isArray(candidate.history) ? candidate.history.map(normalizeHistoryEntry).filter(Boolean) : [],
      createdAt: textOrEmpty(candidate.createdAt),
      updatedAt: textOrEmpty(candidate.updatedAt)
    };
  }

  function normalizeState(candidate) {
    if (!isPlainObject(candidate)) return createDefaultState();
    if (candidate.dataVersion !== DATA_VERSION) throw new Error("Unsupported saved-data version.");
    return {
      ...candidate,
      dataVersion: DATA_VERSION,
      settings: isPlainObject(candidate.settings) ? candidate.settings : {},
      contacts: Array.isArray(candidate.contacts) ? candidate.contacts.map(normalizeContact).filter(Boolean) : []
    };
  }

  function isValidDateValue(value, allowEmpty = true) {
    if (value === "") return allowEmpty;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day, 12);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  }

  function isValidTimeValue(value) {
    return typeof value === "string" && (value === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(value));
  }

  function validateBackupDocument(candidate) {
    if (!isPlainObject(candidate)) throw new Error("This file is not a Follow-Up Tracker backup.");
    if (candidate.backupFormatVersion !== BACKUP_FORMAT_VERSION) throw new Error("This backup format is not supported by this version of the app.");
    if (candidate.appDataVersion !== DATA_VERSION) throw new Error("This backup uses an unsupported application-data version.");
    if (typeof candidate.backupCreatedAt !== "string" || Number.isNaN(Date.parse(candidate.backupCreatedAt))) throw new Error("The backup date is missing or invalid.");
    if (!isPlainObject(candidate.appData) || candidate.appData.dataVersion !== DATA_VERSION) throw new Error("The backup does not contain supported application data.");
    if (!isPlainObject(candidate.appData.settings) || !Array.isArray(candidate.appData.contacts)) throw new Error("The backup application structure is incomplete.");

    const contactIds = new Set();
    const historyIds = new Set();
    const textFields = ["address", "phone", "email", "generalNote", "createdAt", "updatedAt"];
    candidate.appData.contacts.forEach((contact, contactIndex) => {
      const label = `Contact ${contactIndex + 1}`;
      if (!isPlainObject(contact) || typeof contact.id !== "string" || !contact.id || typeof contact.name !== "string" || !contact.name.trim()) throw new Error(`${label} is missing a stable ID or name.`);
      if (contactIds.has(contact.id)) throw new Error("The backup contains duplicate contact IDs.");
      contactIds.add(contact.id);
      if (textFields.some((field) => contact[field] !== undefined && typeof contact[field] !== "string")) throw new Error(`${label} contains invalid contact information.`);
      if (!["followUp", "bibleStudy"].includes(contact.relationshipType)) throw new Error(`${label} has an unsupported relationship type.`);
      if (!isPlainObject(contact.followUp) || !isPlainObject(contact.pause) || !isPlainObject(contact.bibleStudy) || !Array.isArray(contact.history)) throw new Error(`${label} is missing required scheduling or history information.`);
      if (contact.followUp.normalIntervalDays !== null && (!Number.isInteger(contact.followUp.normalIntervalDays) || contact.followUp.normalIntervalDays < 1 || contact.followUp.normalIntervalDays > 3650)) throw new Error(`${label} has an invalid normal interval.`);
      if (!isValidDateValue(contact.followUp.specificDate) || !isValidTimeValue(contact.followUp.specificTime)) throw new Error(`${label} has an invalid follow-up date or time.`);
      if (!["active", "untilDate", "indefinite"].includes(contact.pause.status) || !isValidDateValue(contact.pause.untilDate) || typeof contact.pause.reason !== "string") throw new Error(`${label} has invalid pause information.`);
      const study = contact.bibleStudy;
      if (typeof study.isActive !== "boolean" || !(study.normalDay === "" || /^[0-6]$/.test(study.normalDay)) || !isValidTimeValue(study.normalTime) || !isValidDateValue(study.specificDate) || !isValidTimeValue(study.specificTime)) throw new Error(`${label} has invalid Bible-study scheduling information.`);
      if (["location", "publication", "progress"].some((field) => typeof study[field] !== "string")) throw new Error(`${label} has invalid Bible-study details.`);

      contact.history.forEach((entry, entryIndex) => {
        if (!isPlainObject(entry) || typeof entry.id !== "string" || !entry.id || !["successfulContact", "attemptedContact", "conductedStudy", "missedStudy"].includes(entry.type)) throw new Error(`${label}, history entry ${entryIndex + 1}, is invalid.`);
        if (historyIds.has(entry.id)) throw new Error("The backup contains duplicate history-entry IDs.");
        historyIds.add(entry.id);
        if (!isValidDateValue(entry.date, false) || !isValidTimeValue(entry.time)) throw new Error(`${label}, history entry ${entryIndex + 1}, has an invalid date or time.`);
        if (["discussionNotes", "scriptures", "literature", "note", "studyProgress", "createdAt", "updatedAt"].some((field) => entry[field] !== undefined && typeof entry[field] !== "string")) throw new Error(`${label}, history entry ${entryIndex + 1}, contains invalid text.`);
      });
    });

    return normalizeState(candidate.appData);
  }

  const persistence = {
    load() {
      const storedValue = localStorage.getItem(STORAGE_KEY);
      if (storedValue === null) {
        const initialState = createDefaultState();
        this.save(initialState);
        return initialState;
      }
      try {
        return normalizeState(JSON.parse(storedValue));
      } catch (error) {
        console.error("Saved Follow-Up Tracker data could not be loaded.", error);
        setSaveStatus("Storage needs attention", true);
        return createDefaultState();
      }
    },
    save(nextState) {
      const normalizedState = normalizeState(nextState);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizedState));
      setSaveStatus("Saved on device");
      return normalizedState;
    }
  };

  function setSaveStatus(message, isWarning = false) {
    saveStatusElement.textContent = message;
    saveStatusElement.dataset.warning = String(isWarning);
  }

  function exportBackup() {
    const backup = {
      backupFormatVersion: BACKUP_FORMAT_VERSION,
      backupCreatedAt: new Date().toISOString(),
      appDataVersion: appState.dataVersion,
      appData: appState
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `FollowUpTracker_Backup_${todayDateValue()}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    restoreMessage = "Backup prepared. Store the downloaded file somewhere private and dependable.";
    restoreMessageType = "success";
    renderActiveScreen();
  }

  async function stageRestoreFile(file) {
    pendingRestore = null;
    restoreMessage = "";
    restoreMessageType = "";
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      restoreMessage = "That file is too large to be a valid Follow-Up Tracker backup.";
      restoreMessageType = "error";
      renderActiveScreen();
      return;
    }
    try {
      const parsed = JSON.parse(await file.text());
      const validatedState = validateBackupDocument(parsed);
      pendingRestore = {
        appData: validatedState,
        backupCreatedAt: parsed.backupCreatedAt,
        contactCount: validatedState.contacts.length,
        historyCount: validatedState.contacts.reduce((total, contact) => total + contact.history.length, 0)
      };
      restoreMessage = "Backup validated successfully. Review the replacement details below.";
      restoreMessageType = "success";
    } catch (error) {
      console.error("Backup validation failed.", error);
      restoreMessage = error instanceof Error ? error.message : "The selected backup could not be read.";
      restoreMessageType = "error";
    }
    renderActiveScreen();
  }

  function cancelRestore() {
    pendingRestore = null;
    restoreMessage = "Restore canceled. Current information was not changed.";
    restoreMessageType = "";
    renderActiveScreen();
  }

  function commitRestore() {
    if (!pendingRestore) return;
    const confirmed = window.confirm(`Replace all current Follow-Up Tracker information?\n\nCurrent contacts: ${appState.contacts.length}\nBackup contacts: ${pendingRestore.contactCount}\nBackup history entries: ${pendingRestore.historyCount}\n\nThis replacement cannot be undone unless you already exported a backup of the current information.`);
    if (!confirmed) return;

    const previousState = appState;
    try {
      appState = persistence.save(pendingRestore.appData);
      const verifiedState = normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY)));
      if (JSON.stringify(verifiedState) !== JSON.stringify(appState)) throw new Error("Saved information did not pass read-back verification.");
      pendingRestore = null;
      window.alert("Restore completed and verified. The app will now reload.");
      window.location.reload();
    } catch (error) {
      console.error("Restore could not be completed.", error);
      try { appState = persistence.save(previousState); } catch (rollbackError) { console.error("Previous state could not be rewritten.", rollbackError); }
      restoreMessage = "Restore could not be completed. The previous in-memory information remains active.";
      restoreMessageType = "error";
      renderActiveScreen();
    }
  }

  function escapeHtml(value) {
    return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }

  function sortedContacts() {
    return [...appState.contacts].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }

  function normalizedSearchText(value) {
    return textOrEmpty(value).trim().toLocaleLowerCase();
  }

  function filteredContacts() {
    const query = normalizedSearchText(contactSearchQuery);
    return sortedContacts().filter((contact) => {
      if (showPausedOnly && !isActivelyPaused(contact)) return false;
      if (!query) return true;
      return normalizedSearchText(contact.name).includes(query)
        || normalizedSearchText(contact.address).includes(query);
    });
  }

  function contactInitial(contact) {
    const firstCharacter = contact.name.trim().charAt(0).toLocaleUpperCase();
    return /^[A-Z]$/u.test(firstCharacter) ? firstCharacter : "#";
  }

  function mapsUrl(address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  }

  function todayDateValue() {
    const now = new Date();
    const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return localDate.toISOString().slice(0, 10);
  }

  function currentMonthValue() {
    return todayDateValue().slice(0, 7);
  }

  function formatMonth(monthValue) {
    if (!/^\d{4}-\d{2}$/.test(monthValue)) return "Selected month";
    const date = new Date(`${monthValue}-01T12:00:00`);
    return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "long" }).format(date);
  }

  function formatDate(dateValue, timeValue = "") {
    if (!dateValue) return "Date unavailable";
    const date = new Date(`${dateValue}T12:00:00`);
    const formattedDate = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(date);
    if (!timeValue) return formattedDate;
    const time = new Date(`${dateValue}T${timeValue}:00`);
    const formattedTime = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(time);
    return `${formattedDate} at ${formattedTime}`;
  }

  function historyTimestamp(entry) {
    return `${entry.date || "0000-00-00"}T${entry.time || "00:00"}`;
  }

  function sortedHistory(contact) {
    return [...contact.history].sort((a, b) => historyTimestamp(b).localeCompare(historyTimestamp(a)));
  }

  function isSuccessfulEntry(entry) {
    return entry.type === "successfulContact" || entry.type === "conductedStudy";
  }

  function deriveLastContact(contact) {
    return sortedHistory(contact).find(isSuccessfulEntry) || null;
  }

  function isActivelyPaused(contact, comparisonDate = todayDateValue()) {
    return contact.pause.status === "indefinite"
      || (contact.pause.status === "untilDate" && contact.pause.untilDate > comparisonDate);
  }

  function renderPauseText(contact) {
    if (contact.pause.status === "indefinite") return "Paused indefinitely";
    if (contact.pause.status === "untilDate" && contact.pause.untilDate > todayDateValue()) {
      return `Paused until ${formatDate(contact.pause.untilDate)}`;
    }
    return "Active";
  }

  function addDays(dateValue, numberOfDays) {
    const date = new Date(`${dateValue}T12:00:00`);
    date.setDate(date.getDate() + numberOfDays);
    const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return localDate.toISOString().slice(0, 10);
  }

  function nextWeekdayDate(dayValue, comparisonDate, afterDate = "") {
    const targetDay = Number.parseInt(dayValue, 10);
    if (!Number.isInteger(targetDay) || targetDay < 0 || targetDay > 6) return "";
    let candidate = comparisonDate;
    const date = new Date(`${candidate}T12:00:00`);
    const offset = (targetDay - date.getDay() + 7) % 7;
    candidate = addDays(candidate, offset);
    while (afterDate && candidate <= afterDate) candidate = addDays(candidate, 7);
    return candidate;
  }

  function latestStudyEntry(contact) {
    return sortedHistory(contact).find((entry) => entry.type === "conductedStudy" || entry.type === "missedStudy") || null;
  }

  function deriveNextFollowUp(contact, comparisonDate = todayDateValue()) {
    if (contact.pause.status === "indefinite") {
      return { status: "paused", source: "pause", date: "", time: "" };
    }
    if (contact.pause.status === "untilDate" && contact.pause.untilDate > comparisonDate) {
      return { status: "paused", source: "pause", date: contact.pause.untilDate, time: "" };
    }
    if (contact.relationshipType === "bibleStudy" && contact.bibleStudy.isActive) {
      if (contact.bibleStudy.specificDate) {
        return { status: "scheduled", source: "studySpecific", date: contact.bibleStudy.specificDate, time: contact.bibleStudy.specificTime };
      }
      const latestStudy = latestStudyEntry(contact);
      const nextDate = nextWeekdayDate(contact.bibleStudy.normalDay, comparisonDate, latestStudy?.date || "");
      if (nextDate) return { status: "scheduled", source: "studyRecurring", date: nextDate, time: contact.bibleStudy.normalTime };
      return { status: "unscheduled", source: "none", date: "", time: "" };
    }
    if (contact.followUp.specificDate) {
      return { status: "scheduled", source: "specific", date: contact.followUp.specificDate, time: contact.followUp.specificTime };
    }
    const lastContact = deriveLastContact(contact);
    if (lastContact && Number.isInteger(contact.followUp.normalIntervalDays) && contact.followUp.normalIntervalDays > 0) {
      return { status: "scheduled", source: "normal", date: addDays(lastContact.date, contact.followUp.normalIntervalDays), time: "" };
    }
    return { status: "unscheduled", source: "none", date: "", time: "" };
  }

  function renderScheduleText(contact) {
    const schedule = deriveNextFollowUp(contact);
    if (schedule.status === "paused") return "Paused";
    if (schedule.status === "unscheduled") return "Not scheduled";
    let suffix;
    if (schedule.source === "specific" || schedule.source === "studySpecific") suffix = " · specific arrangement";
    else if (schedule.source === "studyRecurring") suffix = " · normal study schedule";
    else suffix = ` · ${contact.followUp.normalIntervalDays}-day interval`;
    return `${formatDate(schedule.date, schedule.time)}${suffix}`;
  }

  function renderSummaryCard(label, count) {
    return `<article class="summary-card"><span class="summary-card__value">${count}</span><span class="summary-card__label">${label}</span></article>`;
  }

  function deriveMonthlyReport(monthValue) {
    let followUpsMade = 0;
    const conductedStudyContactIds = new Set();

    appState.contacts.forEach((contact) => {
      contact.history.forEach((entry) => {
        if (!entry.date || entry.date.slice(0, 7) !== monthValue) return;
        if (entry.type === "successfulContact" || entry.type === "conductedStudy") followUpsMade += 1;
        if (entry.type === "conductedStudy") conductedStudyContactIds.add(contact.id);
      });
    });

    return { followUpsMade, bibleStudiesConducted: conductedStudyContactIds.size };
  }

  function daysBetween(firstDate, secondDate) {
    const first = new Date(`${firstDate}T12:00:00`);
    const second = new Date(`${secondDate}T12:00:00`);
    return Math.round((second - first) / 86400000);
  }

  function getFollowUpGroups() {
    const today = todayDateValue();
    const groups = { overdue: [], today: [], upcoming: [] };

    appState.contacts.forEach((contact) => {
      const schedule = deriveNextFollowUp(contact, today);
      if (schedule.status !== "scheduled") return;
      const item = { contact, schedule };
      if (schedule.date < today) groups.overdue.push(item);
      else if (schedule.date === today) groups.today.push(item);
      else groups.upcoming.push(item);
    });

    const byDateTimeThenName = (a, b) => {
      const firstKey = `${a.schedule.date}T${a.schedule.time || "99:99"}`;
      const secondKey = `${b.schedule.date}T${b.schedule.time || "99:99"}`;
      return firstKey.localeCompare(secondKey) || a.contact.name.localeCompare(b.contact.name, undefined, { sensitivity: "base" });
    };

    groups.overdue.sort(byDateTimeThenName);
    groups.today.sort(byDateTimeThenName);
    groups.upcoming.sort(byDateTimeThenName);
    return groups;
  }

  function renderFollowUpItem(item, groupName) {
    const { contact, schedule } = item;
    const today = todayDateValue();
    let statusText;
    if (groupName === "overdue") {
      const days = daysBetween(schedule.date, today);
      statusText = `${days} ${days === 1 ? "day" : "days"} overdue`;
    } else if (groupName === "today") {
      statusText = schedule.time ? `Today at ${formatDate(schedule.date, schedule.time).split(" at ")[1]}` : "Due today";
    } else {
      const days = daysBetween(today, schedule.date);
      statusText = `${days === 1 ? "Tomorrow" : `In ${days} days`}`;
    }

    return `
      <article class="follow-up-item follow-up-item--${groupName}">
        <div class="follow-up-item__body">
          <div class="follow-up-item__title-row">
            <h3>${escapeHtml(contact.name)}</h3>
            ${contact.relationshipType === "bibleStudy" ? `<span class="schedule-badge">Bible Study</span>` : ""}
            ${schedule.source === "specific" || schedule.source === "studySpecific" ? `<span class="schedule-badge">Specific</span>` : ""}
          </div>
          <p class="follow-up-item__status">${escapeHtml(statusText)}</p>
          <p class="follow-up-item__date">${escapeHtml(formatDate(schedule.date, schedule.time))}</p>
        </div>
        <button class="button button--secondary" type="button" data-action="open-home-contact" data-contact-id="${escapeHtml(contact.id)}">Open</button>
      </article>`;
  }

  function renderFollowUpGroup(title, groupName, items) {
    if (!items.length) return "";
    return `
      <section class="follow-up-group" aria-labelledby="${groupName}-title">
        <div class="follow-up-group__heading">
          <h3 id="${groupName}-title">${title}</h3>
          <span>${items.length}</span>
        </div>
        <div class="follow-up-list">${items.map((item) => renderFollowUpItem(item, groupName)).join("")}</div>
      </section>`;
  }

  function renderDeferredScreen(title, message) {
    const titleId = `${title.toLowerCase().replaceAll(" ", "-")}-title`;
    return `<section aria-labelledby="${titleId}"><header class="screen-heading"><h2 id="${titleId}">${title}</h2></header><article class="empty-state"><p class="section-label">Planned core feature</p><h3>Not active yet</h3><p>${message}</p></article></section>`;
  }

  function renderContactForm() {
    const contact = contactEditor?.contactId ? appState.contacts.find((item) => item.id === contactEditor.contactId) : null;
    const isEditing = Boolean(contact);
    const intervalDays = contact?.followUp.normalIntervalDays ?? null;
    const commonIntervals = [7, 14, 21, 30];
    const intervalSelection = intervalDays === null ? "none" : commonIntervals.includes(intervalDays) ? String(intervalDays) : "custom";
    const customInterval = intervalSelection === "custom" ? intervalDays : "";
    return `
      <section aria-labelledby="contact-form-title">
        <header class="screen-heading screen-heading--actions">
          <div><p class="section-label">${isEditing ? "Edit contact" : "New contact"}</p><h2 id="contact-form-title">${isEditing ? escapeHtml(contact.name) : "Add a Contact"}</h2></div>
          <button class="button button--secondary" type="button" data-action="cancel-contact">Cancel</button>
        </header>
        <form id="contact-form" class="contact-form" novalidate>
          <div class="field field--full">
            <label for="contact-name">Name <span aria-hidden="true">*</span></label>
            <input id="contact-name" name="name" type="text" required maxlength="120" autocomplete="name" value="${escapeHtml(contact?.name || "")}">
            <p class="field-error" id="name-error" hidden>Please enter a name.</p>
          </div>
          <div class="field field--full">
            <label for="contact-address">Address</label>
            <textarea id="contact-address" name="address" rows="3" maxlength="500" autocomplete="street-address">${escapeHtml(contact?.address || "")}</textarea>
          </div>
          <div class="field">
            <label for="contact-phone">Phone</label>
            <input id="contact-phone" name="phone" type="tel" maxlength="80" autocomplete="tel" value="${escapeHtml(contact?.phone || "")}">
          </div>
          <div class="field">
            <label for="contact-email">Email</label>
            <input id="contact-email" name="email" type="email" maxlength="254" autocomplete="email" value="${escapeHtml(contact?.email || "")}">
          </div>
          <fieldset class="field-group field--full">
            <legend>Follow-Up Schedule</legend>
            <p class="field-help">Set the person’s usual rhythm, or use a specific arrangement when needed.</p>
            <div class="schedule-fields">
              <div class="field">
                <label for="normal-interval">Normal Interval</label>
                <select id="normal-interval" name="intervalSelection">
                  <option value="none" ${intervalSelection === "none" ? "selected" : ""}>Not set</option>
                  <option value="7" ${intervalSelection === "7" ? "selected" : ""}>7 days</option>
                  <option value="14" ${intervalSelection === "14" ? "selected" : ""}>14 days</option>
                  <option value="21" ${intervalSelection === "21" ? "selected" : ""}>21 days</option>
                  <option value="30" ${intervalSelection === "30" ? "selected" : ""}>30 days</option>
                  <option value="custom" ${intervalSelection === "custom" ? "selected" : ""}>Custom</option>
                </select>
              </div>
              <div class="field" data-custom-interval ${intervalSelection === "custom" ? "" : "hidden"}>
                <label for="custom-interval">Custom Days</label>
                <input id="custom-interval" name="customIntervalDays" type="number" min="1" max="3650" inputmode="numeric" value="${escapeHtml(customInterval)}">
                <p class="field-error" id="interval-error" hidden>Enter a custom interval from 1 to 3650 days.</p>
              </div>
              <div class="field">
                <label for="specific-date">Specific Next Date</label>
                <input id="specific-date" name="specificDate" type="date" value="${escapeHtml(contact?.followUp.specificDate || "")}">
              </div>
              <div class="field">
                <label for="specific-time">Specific Time</label>
                <input id="specific-time" name="specificTime" type="time" value="${escapeHtml(contact?.followUp.specificTime || "")}">
                <p class="field-error" id="specific-date-error" hidden>Choose a specific date before adding a time.</p>
              </div>
            </div>
          </fieldset>
          <div class="field field--full">
            <label for="contact-note">General Note</label>
            <p class="field-help">Continuing information such as family, pets, interests, circumstances, or preferred contact method.</p>
            <textarea id="contact-note" name="generalNote" rows="6" maxlength="10000">${escapeHtml(contact?.generalNote || "")}</textarea>
          </div>
          <div class="form-actions field--full">
            <button class="button button--primary" type="submit">${isEditing ? "Save Changes" : "Save Contact"}</button>
            <button class="button button--secondary" type="button" data-action="cancel-contact">Cancel</button>
          </div>
        </form>
      </section>`;
  }

  function renderInteractionForm(contact) {
    const existingEntry = interactionEditor.entryId
      ? contact.history.find((entry) => entry.id === interactionEditor.entryId)
      : null;
    const type = existingEntry?.type || interactionEditor.type;
    if (type === "conductedStudy" || type === "missedStudy") return renderStudyInteractionForm(contact, existingEntry, type);
    const isSuccessful = type === "successfulContact";
    const date = existingEntry?.date || todayDateValue();

    return `
      <section aria-labelledby="interaction-form-title">
        <header class="screen-heading screen-heading--actions">
          <div>
            <p class="section-label">${existingEntry ? "Edit history" : "New history"}</p>
            <h2 id="interaction-form-title">${isSuccessful ? "Successful Contact" : "Attempted Contact"}</h2>
            <p>${escapeHtml(contact.name)}</p>
          </div>
          <button class="button button--secondary" type="button" data-action="cancel-interaction">Cancel</button>
        </header>
        <form id="interaction-form" class="contact-form" novalidate>
          <input type="hidden" name="type" value="${type}">
          <div class="field">
            <label for="interaction-date">Date <span aria-hidden="true">*</span></label>
            <input id="interaction-date" name="date" type="date" required value="${escapeHtml(date)}">
            <p class="field-error" id="date-error" hidden>Please enter a date.</p>
          </div>
          <div class="field">
            <label for="interaction-time">Time</label>
            <input id="interaction-time" name="time" type="time" value="${escapeHtml(existingEntry?.time || "")}">
          </div>
          ${isSuccessful ? `
            <div class="field field--full">
              <label for="discussion-notes">Discussion Notes</label>
              <textarea id="discussion-notes" name="discussionNotes" rows="6" maxlength="10000">${escapeHtml(existingEntry?.discussionNotes || "")}</textarea>
            </div>
            <div class="field">
              <label for="scriptures">Scripture(s)</label>
              <textarea id="scriptures" name="scriptures" rows="3" maxlength="2000">${escapeHtml(existingEntry?.scriptures || "")}</textarea>
            </div>
            <div class="field">
              <label for="literature">Literature Placed</label>
              <textarea id="literature" name="literature" rows="3" maxlength="2000">${escapeHtml(existingEntry?.literature || "")}</textarea>
            </div>` : `
            <div class="field field--full">
              <label for="attempt-note">Brief Note</label>
              <textarea id="attempt-note" name="note" rows="4" maxlength="4000">${escapeHtml(existingEntry?.note || "")}</textarea>
            </div>`}
          ${isSuccessful && !existingEntry ? `
            <fieldset class="field-group field--full">
              <legend>Next Follow-Up</legend>
              <p class="field-help">A new successful contact satisfies the current follow-up. Choose what should happen next.</p>
              <div class="field">
                <label for="next-follow-up-mode">Next action</label>
                <select id="next-follow-up-mode" name="nextFollowUpMode">
                  <option value="normal">Use normal interval${contact.followUp.normalIntervalDays ? ` (${contact.followUp.normalIntervalDays} days)` : " (not set)"}</option>
                  <option value="specific">Use a specific date and time</option>
                </select>
              </div>
              <div class="schedule-fields" data-interaction-specific hidden>
                <div class="field">
                  <label for="next-specific-date">Specific Date <span aria-hidden="true">*</span></label>
                  <input id="next-specific-date" name="nextSpecificDate" type="date">
                  <p class="field-error" id="next-date-error" hidden>Please choose the specific next date.</p>
                </div>
                <div class="field">
                  <label for="next-specific-time">Specific Time</label>
                  <input id="next-specific-time" name="nextSpecificTime" type="time">
                </div>
              </div>
            </fieldset>` : ""}
          <div class="form-actions field--full">
            <button class="button button--primary" type="submit">${existingEntry ? "Save Changes" : "Save Entry"}</button>
            <button class="button button--secondary" type="button" data-action="cancel-interaction">Cancel</button>
          </div>
        </form>
      </section>`;
  }

  function dayOptions(selectedDay = "") {
    return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
      .map((label, index) => `<option value="${index}" ${String(index) === selectedDay ? "selected" : ""}>${label}</option>`)
      .join("");
  }

  function renderStudyLifecycleForm(contact) {
    const isEnding = studyLifecycleEditor === "end";
    const isEditingStudy = contact.relationshipType === "bibleStudy" && contact.bibleStudy.isActive;
    if (isEnding) {
      const intervalDays = contact.followUp.normalIntervalDays;
      const commonIntervals = [7, 14, 21, 30];
      const intervalSelection = intervalDays === null ? "none" : commonIntervals.includes(intervalDays) ? String(intervalDays) : "custom";
      return `
        <section aria-labelledby="study-lifecycle-title">
          <header class="screen-heading screen-heading--actions"><div><p class="section-label">Bible Study → Follow-Up</p><h2 id="study-lifecycle-title">End Bible Study</h2><p>${escapeHtml(contact.name)}</p></div><button class="button button--secondary" type="button" data-action="cancel-study-lifecycle">Cancel</button></header>
          <form id="end-study-form" class="contact-form" novalidate>
            <p class="field-help field--full">The complete history remains. The recurring study schedule will be deactivated, and ordinary follow-up scheduling will resume.</p>
            <div class="field"><label for="end-interval">Normal Follow-Up Interval</label><select id="end-interval" name="intervalSelection"><option value="none" ${intervalSelection === "none" ? "selected" : ""}>Not set</option><option value="7" ${intervalSelection === "7" ? "selected" : ""}>7 days</option><option value="14" ${intervalSelection === "14" ? "selected" : ""}>14 days</option><option value="21" ${intervalSelection === "21" ? "selected" : ""}>21 days</option><option value="30" ${intervalSelection === "30" ? "selected" : ""}>30 days</option><option value="custom" ${intervalSelection === "custom" ? "selected" : ""}>Custom</option></select></div>
            <div class="field" data-custom-interval ${intervalSelection === "custom" ? "" : "hidden"}><label for="end-custom-interval">Custom Days</label><input id="end-custom-interval" name="customIntervalDays" type="number" min="1" max="3650" inputmode="numeric" value="${intervalSelection === "custom" ? intervalDays : ""}"><p class="field-error" id="interval-error" hidden>Enter a custom interval from 1 to 3650 days.</p></div>
            <div class="field"><label for="end-specific-date">Specific Next Date</label><input id="end-specific-date" name="specificDate" type="date"></div>
            <div class="field"><label for="end-specific-time">Specific Time</label><input id="end-specific-time" name="specificTime" type="time"><p class="field-error" id="specific-date-error" hidden>Choose a specific date before adding a time.</p></div>
            <div class="form-actions field--full"><button class="button button--primary" type="submit">Return to Follow-Up</button><button class="button button--secondary" type="button" data-action="cancel-study-lifecycle">Cancel</button></div>
          </form>
        </section>`;
    }

    return `
      <section aria-labelledby="study-lifecycle-title">
        <header class="screen-heading screen-heading--actions"><div><p class="section-label">${isEditingStudy ? "Bible Study Settings" : "Follow-Up → Bible Study"}</p><h2 id="study-lifecycle-title">${isEditingStudy ? "Edit Bible Study" : "Establish Bible Study"}</h2><p>${escapeHtml(contact.name)}</p></div><button class="button button--secondary" type="button" data-action="cancel-study-lifecycle">Cancel</button></header>
        <form id="start-study-form" class="contact-form" novalidate>
          <p class="field-help field--full">This keeps the same contact record and complete earlier history.</p>
          <div class="field"><label for="study-normal-day">Normal Study Day</label><select id="study-normal-day" name="normalDay"><option value="">Not set</option>${dayOptions(contact.bibleStudy.normalDay)}</select></div>
          <div class="field"><label for="study-normal-time">Normal Study Time</label><input id="study-normal-time" name="normalTime" type="time" value="${escapeHtml(contact.bibleStudy.normalTime)}"><p class="field-error" id="study-day-error" hidden>Choose a normal study day before adding a time.</p></div>
          <div class="field field--full"><label for="study-location">Location</label><input id="study-location" name="location" type="text" maxlength="500" value="${escapeHtml(contact.bibleStudy.location)}"></div>
          <div class="field"><label for="study-publication">Publication</label><input id="study-publication" name="publication" type="text" maxlength="500" value="${escapeHtml(contact.bibleStudy.publication)}"></div>
          <div class="field"><label for="study-progress">Current Progress</label><input id="study-progress" name="progress" type="text" maxlength="500" value="${escapeHtml(contact.bibleStudy.progress)}"></div>
          <fieldset class="field-group field--full"><legend>Particular Upcoming Study</legend><p class="field-help">Optional. This overrides the normal study schedule once without replacing it.</p><div class="schedule-fields"><div class="field"><label for="study-specific-date">Specific Date</label><input id="study-specific-date" name="specificDate" type="date" value="${escapeHtml(contact.bibleStudy.specificDate)}"></div><div class="field"><label for="study-specific-time">Specific Time</label><input id="study-specific-time" name="specificTime" type="time" value="${escapeHtml(contact.bibleStudy.specificTime)}"><p class="field-error" id="study-specific-date-error" hidden>Choose a specific date before adding a time.</p></div></div></fieldset>
          <div class="form-actions field--full"><button class="button button--primary" type="submit">${isEditingStudy ? "Save Study" : "Establish Bible Study"}</button><button class="button button--secondary" type="button" data-action="cancel-study-lifecycle">Cancel</button></div>
        </form>
      </section>`;
  }

  function renderStudyInteractionForm(contact, existingEntry, type) {
    const conducted = type === "conductedStudy";
    const date = existingEntry?.date || todayDateValue();
    return `
      <section aria-labelledby="interaction-form-title">
        <header class="screen-heading screen-heading--actions"><div><p class="section-label">${existingEntry ? "Edit history" : "New study history"}</p><h2 id="interaction-form-title">${conducted ? "Conducted Study" : "Missed/Attempted Study"}</h2><p>${escapeHtml(contact.name)}</p></div><button class="button button--secondary" type="button" data-action="cancel-interaction">Cancel</button></header>
        <form id="interaction-form" class="contact-form" novalidate>
          <input type="hidden" name="type" value="${type}">
          <div class="field"><label for="interaction-date">Date <span aria-hidden="true">*</span></label><input id="interaction-date" name="date" type="date" required value="${escapeHtml(date)}"><p class="field-error" id="date-error" hidden>Please enter a date.</p></div>
          <div class="field"><label for="interaction-time">Time</label><input id="interaction-time" name="time" type="time" value="${escapeHtml(existingEntry?.time || "")}"></div>
          ${conducted ? `<div class="field field--full"><label for="discussion-notes">Discussion Notes</label><textarea id="discussion-notes" name="discussionNotes" rows="5" maxlength="10000">${escapeHtml(existingEntry?.discussionNotes || "")}</textarea></div><div class="field"><label for="scriptures">Scripture(s)</label><textarea id="scriptures" name="scriptures" rows="3" maxlength="2000">${escapeHtml(existingEntry?.scriptures || "")}</textarea></div><div class="field"><label for="study-entry-progress">Progress After Study</label><input id="study-entry-progress" name="studyProgress" type="text" maxlength="500" value="${escapeHtml(existingEntry ? existingEntry.studyProgress : contact.bibleStudy.progress)}"></div>` : `<div class="field field--full"><label for="attempt-note">Brief Note</label><textarea id="attempt-note" name="note" rows="4" maxlength="4000">${escapeHtml(existingEntry?.note || "")}</textarea></div>`}
          ${!existingEntry ? `<fieldset class="field-group field--full"><legend>Next Study</legend><p class="field-help">Use the normal weekly schedule, or make a one-time change.</p><div class="field"><label for="next-study-mode">Next action</label><select id="next-study-mode" name="nextStudyMode"><option value="normal">Use normal study schedule</option><option value="specific">Use a specific date and time</option></select></div><div class="schedule-fields" data-study-specific hidden><div class="field"><label for="next-study-date">Specific Date <span aria-hidden="true">*</span></label><input id="next-study-date" name="nextStudyDate" type="date"><p class="field-error" id="next-study-date-error" hidden>Please choose the specific next date.</p></div><div class="field"><label for="next-study-time">Specific Time</label><input id="next-study-time" name="nextStudyTime" type="time"></div></div></fieldset>` : ""}
          <div class="form-actions field--full"><button class="button button--primary" type="submit">${existingEntry ? "Save Changes" : "Save Entry"}</button><button class="button button--secondary" type="button" data-action="cancel-interaction">Cancel</button></div>
        </form>
      </section>`;
  }

  function renderHistoryEntry(entry) {
    const isSuccessful = isSuccessfulEntry(entry);
    const labels = { successfulContact: "Successful Contact", attemptedContact: "Attempted Contact", conductedStudy: "Conducted Bible Study", missedStudy: "Missed/Attempted Study" };
    const content = isSuccessful
      ? [entry.discussionNotes, entry.scriptures ? `Scripture(s): ${entry.scriptures}` : "", entry.literature ? `Literature: ${entry.literature}` : "", entry.studyProgress ? `Study progress: ${entry.studyProgress}` : ""].filter(Boolean)
      : [entry.note].filter(Boolean);

    return `
      <article class="history-entry history-entry--${isSuccessful ? "successful" : "attempted"}">
        <div class="history-entry__heading">
          <div>
            <p class="history-entry__type">${labels[entry.type] || "Interaction"}</p>
            <p class="history-entry__date">${escapeHtml(formatDate(entry.date, entry.time))}</p>
          </div>
          <div class="history-entry__actions">
            <button class="text-button" type="button" data-action="edit-interaction" data-entry-id="${escapeHtml(entry.id)}">Edit</button>
            <button class="text-button text-button--danger" type="button" data-action="delete-interaction" data-entry-id="${escapeHtml(entry.id)}">Delete</button>
          </div>
        </div>
        ${content.length ? `<div class="history-entry__content">${content.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}</div>` : `<p class="muted-text">No additional notes.</p>`}
      </article>`;
  }

  function renderPauseForm(contact) {
    const selectedStatus = isActivelyPaused(contact) ? contact.pause.status : "untilDate";
    return `
      <section aria-labelledby="pause-form-title">
        <header class="screen-heading screen-heading--actions">
          <div>
            <p class="section-label">Pause follow-up</p>
            <h2 id="pause-form-title">${escapeHtml(contact.name)}</h2>
            <p>Pause removes this person from Needs Follow-Up without changing their history or schedule.</p>
          </div>
          <button class="button button--secondary" type="button" data-action="cancel-pause">Cancel</button>
        </header>
        <form id="pause-form" class="contact-form" novalidate>
          <fieldset class="field-group field--full">
            <legend>Pause Length</legend>
            <div class="choice-list">
              <label class="choice-row">
                <input type="radio" name="pauseStatus" value="untilDate" ${selectedStatus === "untilDate" ? "checked" : ""}>
                <span>Pause until a date</span>
              </label>
              <label class="choice-row">
                <input type="radio" name="pauseStatus" value="indefinite" ${selectedStatus === "indefinite" ? "checked" : ""}>
                <span>Pause indefinitely</span>
              </label>
            </div>
          </fieldset>
          <div class="field field--full" data-pause-date ${selectedStatus === "untilDate" ? "" : "hidden"}>
            <label for="pause-until-date">Resume on <span aria-hidden="true">*</span></label>
            <input id="pause-until-date" name="pauseUntilDate" type="date" min="${addDays(todayDateValue(), 1)}" value="${escapeHtml(isActivelyPaused(contact) && contact.pause.status === "untilDate" ? contact.pause.untilDate : "")}">
            <p class="field-help">The contact automatically returns to normal Needs Follow-Up behavior on this date.</p>
            <p class="field-error" id="pause-date-error" hidden>Choose a date after today.</p>
          </div>
          <div class="field field--full">
            <label for="pause-reason">Reason</label>
            <textarea id="pause-reason" name="pauseReason" rows="3" maxlength="1000">${escapeHtml(contact.pause.reason)}</textarea>
          </div>
          <div class="form-actions field--full">
            <button class="button button--primary" type="submit">Save Pause</button>
            <button class="button button--secondary" type="button" data-action="cancel-pause">Cancel</button>
          </div>
        </form>
      </section>`;
  }

  function renderContactDetail(contact) {
    if (interactionEditor) return renderInteractionForm(contact);
    if (pauseEditor) return renderPauseForm(contact);
    if (studyLifecycleEditor) return renderStudyLifecycleForm(contact);
    const history = sortedHistory(contact);
    const lastContact = deriveLastContact(contact);
    const isPaused = isActivelyPaused(contact);
    const isStudy = contact.relationshipType === "bibleStudy" && contact.bibleStudy.isActive;
    return `
      <section aria-labelledby="contact-detail-title">
        <header class="screen-heading">
          <button class="back-button" type="button" data-action="back-to-list">← ${activeScreen === "studies" ? "Bible Studies" : "All Contacts"}</button>
          <div class="detail-title-row">
            <div>
              <div class="follow-up-item__title-row"><h2 id="contact-detail-title">${escapeHtml(contact.name)}</h2>${isStudy ? `<span class="schedule-badge">Bible Study</span>` : ""}</div>
              <p>Last Contact: ${lastContact ? escapeHtml(formatDate(lastContact.date, lastContact.time)) : "None recorded"}</p>
              <p>${isStudy ? "Next Study" : "Next Follow-Up"}: ${escapeHtml(renderScheduleText(contact))}</p>
            </div>
            <div class="detail-actions">
              <button class="button ${isPaused ? "button--primary" : "button--secondary"}" type="button" data-action="${isPaused ? "resume-contact" : "pause-contact"}" data-contact-id="${escapeHtml(contact.id)}">${isPaused ? "Resume" : "Pause"}</button>
              <button class="button button--secondary" type="button" data-action="edit-contact" data-contact-id="${escapeHtml(contact.id)}">Edit Contact</button>
              ${isStudy ? `<button class="button button--secondary" type="button" data-action="edit-study" data-contact-id="${escapeHtml(contact.id)}">Edit Study</button>` : ""}
              <button class="button button--secondary" type="button" data-action="${isStudy ? "end-study" : "start-study"}" data-contact-id="${escapeHtml(contact.id)}">${isStudy ? "End Bible Study" : "Establish Bible Study"}</button>
            </div>
          </div>
        </header>

        ${isPaused ? `<aside class="pause-banner"><strong>${escapeHtml(renderPauseText(contact))}</strong>${contact.pause.reason ? `<span>${escapeHtml(contact.pause.reason)}</span>` : ""}</aside>` : ""}

        <article class="panel contact-profile">
          ${contact.address ? `<div><span>Address</span><p>${escapeHtml(contact.address)}</p><a class="contact-action-link" href="${escapeHtml(mapsUrl(contact.address))}" target="_blank" rel="noopener noreferrer">Open in Maps</a></div>` : ""}
          ${contact.phone ? `<div><span>Phone</span><p>${escapeHtml(contact.phone)}</p><a class="contact-action-link" href="tel:${escapeHtml(contact.phone)}">Call</a></div>` : ""}
          ${contact.email ? `<div><span>Email</span><p>${escapeHtml(contact.email)}</p><a class="contact-action-link" href="mailto:${escapeHtml(contact.email)}">Compose Email</a></div>` : ""}
          ${contact.generalNote ? `<div class="contact-profile__full"><span>General Note</span><p>${escapeHtml(contact.generalNote)}</p></div>` : ""}
          ${![contact.address, contact.phone, contact.email, contact.generalNote].some(Boolean) ? `<p class="muted-text">No additional contact information.</p>` : ""}
        </article>

        ${isStudy ? `<article class="panel contact-profile study-profile"><div><span>Normal Schedule</span><p>${contact.bibleStudy.normalDay !== "" ? `${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][Number(contact.bibleStudy.normalDay)]}${contact.bibleStudy.normalTime ? ` at ${formatDate(todayDateValue(), contact.bibleStudy.normalTime).split(" at ")[1]}` : ""}` : "Not set"}</p></div><div><span>Location</span><p>${escapeHtml(contact.bibleStudy.location || "Not set")}</p></div><div><span>Publication</span><p>${escapeHtml(contact.bibleStudy.publication || "Not set")}</p></div><div><span>Current Progress</span><p>${escapeHtml(contact.bibleStudy.progress || "Not set")}</p></div></article>` : ""}

        <section class="history-section" aria-labelledby="history-title">
          <div class="history-section__heading">
            <div><p class="section-label">Continuous history</p><h3 id="history-title">Contact History</h3></div>
            <div class="history-actions">
              <button class="button button--primary" type="button" data-action="${isStudy ? "add-conducted-study" : "add-successful"}">${isStudy ? "Conducted Study" : "Successful Contact"}</button>
              <button class="button button--secondary" type="button" data-action="${isStudy ? "add-missed-study" : "add-attempted"}">${isStudy ? "Missed/Attempted" : "Attempted Contact"}</button>
            </div>
          </div>
          ${history.length ? `<div class="history-list">${history.map(renderHistoryEntry).join("")}</div>` : `<article class="empty-state"><h3>No history yet</h3><p>Record a successful or attempted interaction. Attempts remain visible but do not become Last Contact.</p></article>`}
        </section>
      </section>`;
  }

  function renderContactCard(contact) {
    const details = [contact.address, contact.phone, contact.email].filter(Boolean);
    const lastContact = deriveLastContact(contact);
    const isPaused = isActivelyPaused(contact);
    return `
      <article class="contact-card">
        <div class="contact-card__body">
          <div class="follow-up-item__title-row"><h3>${escapeHtml(contact.name)}</h3>${contact.relationshipType === "bibleStudy" ? `<span class="schedule-badge">Bible Study</span>` : ""}${isPaused ? `<span class="pause-badge">Paused</span>` : ""}</div>
          <p class="contact-card__last">Last Contact: ${lastContact ? escapeHtml(formatDate(lastContact.date)) : "None recorded"}</p>
          <p class="contact-card__last">${isPaused ? escapeHtml(renderPauseText(contact)) : `${contact.relationshipType === "bibleStudy" ? "Next Study" : "Next Follow-Up"}: ${escapeHtml(renderScheduleText(contact))}`}</p>
          ${isPaused && contact.pause.reason ? `<p class="pause-reason">${escapeHtml(contact.pause.reason)}</p>` : ""}
          ${details.length ? `<div class="contact-details">${details.map((detail) => `<p>${escapeHtml(detail)}</p>`).join("")}</div>` : `<p class="muted-text">No contact details added.</p>`}
          ${contact.generalNote ? `<p class="contact-note">${escapeHtml(contact.generalNote)}</p>` : ""}
        </div>
        <div class="contact-card__actions">
          <button class="button button--primary" type="button" data-action="open-contact" data-contact-id="${escapeHtml(contact.id)}">Open</button>
          <button class="button button--secondary" type="button" data-action="edit-contact" data-contact-id="${escapeHtml(contact.id)}">Edit</button>
          <button class="button button--danger-subtle" type="button" data-action="delete-contact" data-contact-id="${escapeHtml(contact.id)}">Delete</button>
        </div>
      </article>`;
  }

  function renderAlphabeticalContacts(contacts) {
    let previousInitial = "";
    return contacts.map((contact) => {
      const initial = contactInitial(contact);
      const heading = initial === previousInitial ? "" : `<h3 class="alphabet-heading" aria-label="Names beginning with ${escapeHtml(initial)}">${escapeHtml(initial)}</h3>`;
      previousInitial = initial;
      return `${heading}${renderContactCard(contact)}`;
    }).join("");
  }

  function renderContactResults() {
    const contacts = filteredContacts();
    const query = contactSearchQuery.trim();
    const countText = `${contacts.length} ${contacts.length === 1 ? "person" : "people"}${query ? " found" : ""}`;
    const emptyTitle = query ? "No matching contacts" : showPausedOnly ? "No paused contacts" : "No contacts yet";
    const emptyText = query
      ? "Try a different name or street address. History notes are intentionally not searched."
      : showPausedOnly
        ? "Contacts paused until a future date or indefinitely will appear here."
        : "Add a person’s permanent information here, then open their record to begin the continuous history.";
    return {
      countText,
      markup: contacts.length
        ? `<div class="contact-list">${renderAlphabeticalContacts(contacts)}</div>`
        : `<article class="empty-state"><p class="section-label">${query ? "Search" : showPausedOnly ? "Paused contacts" : "Ready to begin"}</p><h3>${emptyTitle}</h3><p>${emptyText}</p></article>`
    };
  }

  function renderStudyCard(contact) {
    const paused = isActivelyPaused(contact);
    return `<article class="contact-card"><div class="contact-card__body"><div class="follow-up-item__title-row"><h3>${escapeHtml(contact.name)}</h3>${paused ? `<span class="pause-badge">Paused</span>` : ""}</div><p class="contact-card__last">${paused ? escapeHtml(renderPauseText(contact)) : `Next Study: ${escapeHtml(renderScheduleText(contact))}`}</p>${contact.bibleStudy.publication ? `<p class="muted-text">${escapeHtml(contact.bibleStudy.publication)}</p>` : ""}${contact.bibleStudy.progress ? `<p class="muted-text">Progress: ${escapeHtml(contact.bibleStudy.progress)}</p>` : ""}${contact.bibleStudy.location ? `<p class="muted-text">Location: ${escapeHtml(contact.bibleStudy.location)}</p>` : ""}</div><div class="contact-card__actions"><button class="button button--primary" type="button" data-action="open-study" data-contact-id="${escapeHtml(contact.id)}">Open</button></div></article>`;
  }

  const screenRenderers = {
    home() {
      const contactCount = appState.contacts.length;
      const groups = getFollowUpGroups();
      const scheduledCount = groups.overdue.length + groups.today.length + groups.upcoming.length;
      return `
        <section aria-labelledby="home-title">
          <header class="screen-heading"><h2 id="home-title">Needs Follow-Up</h2><p>Overdue contacts come first, followed by today’s contacts and upcoming plans.</p></header>
          <div class="summary-grid" aria-label="Follow-up summary">${renderSummaryCard("Overdue", groups.overdue.length)}${renderSummaryCard("Due today", groups.today.length)}${renderSummaryCard("Upcoming", groups.upcoming.length)}</div>
          ${scheduledCount ? `
            <div class="follow-up-groups">
              ${renderFollowUpGroup("Overdue", "overdue", groups.overdue)}
              ${renderFollowUpGroup("Due Today", "today", groups.today)}
              ${renderFollowUpGroup("Upcoming", "upcoming", groups.upcoming)}
            </div>` : `
            <article class="empty-state">
              <p class="section-label">Nothing scheduled</p>
              <h3>${contactCount === 0 ? "No contacts yet" : "No follow-ups need attention"}</h3>
              <p>${contactCount === 0 ? "Add your first contact to begin." : "Contacts without a schedule remain available from the Contacts screen."}</p>
              <button class="button button--primary button--spaced" type="button" data-action="open-contacts">${contactCount === 0 ? "Add a Contact" : "View Contacts"}</button>
            </article>`}
        </section>`;
    },
    contacts() {
      if (contactEditor) return renderContactForm();
      if (activeContactId) {
        const activeContact = appState.contacts.find((contact) => contact.id === activeContactId);
        if (activeContact) return renderContactDetail(activeContact);
        activeContactId = null;
        interactionEditor = null;
      }
      const allContacts = sortedContacts();
      const pausedCount = allContacts.filter((contact) => isActivelyPaused(contact)).length;
      const results = renderContactResults();
      return `
        <section aria-labelledby="contacts-title">
          <header class="screen-heading screen-heading--actions">
            <div><h2 id="contacts-title">${showPausedOnly ? "Paused Contacts" : "Contacts"}</h2><p id="contact-result-count" aria-live="polite">${results.countText}</p></div>
            <div class="heading-actions">
              <button class="button button--secondary" type="button" data-action="toggle-paused-view">${showPausedOnly ? "All Contacts" : `Paused (${pausedCount})`}</button>
              <button class="button button--primary" type="button" data-action="new-contact">Add Contact</button>
            </div>
          </header>
          <div class="contact-search" role="search">
            <label for="contact-search">Search by name or street address</label>
            <div class="contact-search__controls">
              <input id="contact-search" name="contactSearch" type="search" inputmode="search" autocomplete="off" value="${escapeHtml(contactSearchQuery)}" placeholder="Name or address">
              ${contactSearchQuery ? `<button class="button button--secondary" type="button" data-action="clear-contact-search">Clear</button>` : ""}
            </div>
          </div>
          <div id="contact-results">${results.markup}</div>
        </section>`;
    },
    studies() {
      if (contactEditor) return renderContactForm();
      if (activeContactId) {
        const activeContact = appState.contacts.find((contact) => contact.id === activeContactId && contact.relationshipType === "bibleStudy");
        if (activeContact) return renderContactDetail(activeContact);
        activeContactId = null;
        interactionEditor = null;
        studyLifecycleEditor = null;
      }
      const studies = sortedContacts().filter((contact) => contact.relationshipType === "bibleStudy" && contact.bibleStudy.isActive);
      return `<section aria-labelledby="studies-title"><header class="screen-heading"><h2 id="studies-title">Bible Studies</h2><p>${studies.length} ${studies.length === 1 ? "active study" : "active studies"}</p></header>${studies.length ? `<div class="contact-list">${studies.map(renderStudyCard).join("")}</div>` : `<article class="empty-state"><p class="section-label">Bible Studies</p><h3>No active studies</h3><p>Open a contact and choose Establish Bible Study when a follow-up progresses.</p><button class="button button--primary button--spaced" type="button" data-action="open-contacts">View Contacts</button></article>`}</section>`;
    },
    report() {
      const report = deriveMonthlyReport(reportMonth);
      return `
        <section aria-labelledby="report-title">
          <header class="screen-heading"><h2 id="report-title">Monthly Report</h2><p>Calculated automatically from saved contact history.</p></header>
          <div class="report-month-control">
            <label for="report-month">Report month</label>
            <input id="report-month" name="reportMonth" type="month" max="${currentMonthValue()}" value="${escapeHtml(reportMonth)}">
          </div>
          <h3 class="report-period">${escapeHtml(formatMonth(reportMonth))}</h3>
          <div class="report-results">
            <article class="report-card"><span class="report-card__value">${report.followUpsMade}</span><span class="report-card__label">Follow-ups made</span></article>
            <article class="report-card"><span class="report-card__value">${report.bibleStudiesConducted}</span><span class="report-card__label">Bible studies conducted</span></article>
          </div>
          <article class="panel report-explanation">
            <h3>How these totals work</h3>
            <p><strong>Follow-ups made</strong> counts every successful contact during the selected month. Each conducted Bible-study session also counts as one successful follow-up.</p>
            <p><strong>Bible studies conducted</strong> counts unique people with at least one conducted study during the month, not the number of sessions.</p>
            <p>Attempts, missed studies, and scheduled studies that did not occur are not counted.</p>
          </article>
        </section>`;
    },
    data() {
      const createdText = pendingRestore ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(pendingRestore.backupCreatedAt)) : "";
      return `
        <section aria-labelledby="data-title">
          <header class="screen-heading"><h2 id="data-title">Data &amp; Settings</h2><p>Local persistence and complete Backup/Restore are active.</p></header>
          <article class="panel"><p class="section-label">Application status</p><dl class="status-list"><div class="status-row"><dt>Data version</dt><dd>${appState.dataVersion}</dd></div><div class="status-row"><dt>Backup format</dt><dd>${BACKUP_FORMAT_VERSION}</dd></div><div class="status-row"><dt>Storage</dt><dd>On this device</dd></div><div class="status-row"><dt>Contacts</dt><dd>${appState.contacts.length}</dd></div></dl></article>
          <article class="panel data-action-panel"><div><p class="section-label">Backup</p><h3>Export Complete Backup</h3><p>Download all contacts, schedules, study information, settings, and history as one JSON file.</p></div><button class="button button--primary" type="button" data-action="export-backup">Export Backup</button></article>
          <article class="panel data-action-panel"><div><p class="section-label">Restore</p><h3>Restore from Backup</h3><p>The selected file is parsed, validated, and version-checked before replacement is offered.</p></div><label class="button button--secondary file-button" for="restore-file">Choose Backup File</label><input class="visually-hidden" id="restore-file" name="restoreFile" type="file" accept="application/json,.json"></article>
          ${restoreMessage ? `<p class="restore-message restore-message--${restoreMessageType || "neutral"}" role="status">${escapeHtml(restoreMessage)}</p>` : ""}
          ${pendingRestore ? `<article class="panel restore-confirmation"><p class="section-label">Validated backup</p><h3>Ready to Replace Current Data</h3><dl class="status-list"><div class="status-row"><dt>Backup created</dt><dd>${escapeHtml(createdText)}</dd></div><div class="status-row"><dt>Contacts</dt><dd>${pendingRestore.contactCount}</dd></div><div class="status-row"><dt>History entries</dt><dd>${pendingRestore.historyCount}</dd></div></dl><p>This will replace the complete current dataset. Export the current data first if you may need to recover it.</p><div class="form-actions"><button class="button button--danger-subtle" type="button" data-action="confirm-restore">Replace Current Data</button><button class="button button--secondary" type="button" data-action="cancel-restore">Cancel</button></div></article>` : ""}
          <p class="privacy-note">Exported backups may contain names, addresses, phone numbers, email addresses, private notes, schedules, and complete history. Store backup files securely and avoid sharing them unnecessarily.</p>
        </section>`;
    }
  };

  function renderActiveScreen() {
    const renderer = screenRenderers[activeScreen] || screenRenderers.home;
    mainElement.innerHTML = renderer();
    navigationElement.querySelectorAll("[data-screen]").forEach((button) => {
      if (button.dataset.screen === activeScreen) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
  }

  function selectScreen(screenName) {
    if (!VALID_SCREENS.has(screenName)) return;
    activeScreen = screenName;
    contactEditor = null;
    activeContactId = null;
    interactionEditor = null;
    pauseEditor = false;
    studyLifecycleEditor = null;
    showPausedOnly = false;
    contactSearchQuery = "";
    renderActiveScreen();
    mainElement.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function readContactForm(form) {
    const formData = new FormData(form);
    const intervalSelection = textOrEmpty(formData.get("intervalSelection"));
    const customIntervalDays = Number.parseInt(textOrEmpty(formData.get("customIntervalDays")), 10);
    const normalIntervalDays = intervalSelection === "custom"
      ? customIntervalDays
      : intervalSelection === "none" ? null : Number.parseInt(intervalSelection, 10);
    return {
      name: textOrEmpty(formData.get("name")).trim(),
      address: textOrEmpty(formData.get("address")).trim(),
      phone: textOrEmpty(formData.get("phone")).trim(),
      email: textOrEmpty(formData.get("email")).trim(),
      generalNote: textOrEmpty(formData.get("generalNote")).trim(),
      intervalSelection,
      normalIntervalDays,
      specificDate: textOrEmpty(formData.get("specificDate")),
      specificTime: textOrEmpty(formData.get("specificTime"))
    };
  }

  function saveContact(form) {
    const values = readContactForm(form);
    const nameInput = form.elements.name;
    const nameError = form.querySelector("#name-error");
    if (!values.name) {
      nameInput.setAttribute("aria-invalid", "true");
      nameError.hidden = false;
      nameInput.focus();
      return;
    }

    if (values.intervalSelection === "custom" && (!Number.isInteger(values.normalIntervalDays) || values.normalIntervalDays < 1 || values.normalIntervalDays > 3650)) {
      const customInput = form.elements.customIntervalDays;
      customInput.setAttribute("aria-invalid", "true");
      form.querySelector("#interval-error").hidden = false;
      customInput.focus();
      return;
    }

    if (values.specificTime && !values.specificDate) {
      const specificDateInput = form.elements.specificDate;
      specificDateInput.setAttribute("aria-invalid", "true");
      form.querySelector("#specific-date-error").hidden = false;
      specificDateInput.focus();
      return;
    }

    const now = new Date().toISOString();
    let nextContacts;
    if (contactEditor?.contactId) {
      nextContacts = appState.contacts.map((contact) => contact.id === contactEditor.contactId ? {
        ...contact,
        name: values.name,
        address: values.address,
        phone: values.phone,
        email: values.email,
        generalNote: values.generalNote,
        followUp: {
          ...contact.followUp,
          normalIntervalDays: values.normalIntervalDays,
          specificDate: values.specificDate,
          specificTime: values.specificDate ? values.specificTime : ""
        },
        updatedAt: now
      } : contact);
    } else {
      const newContact = createContact(values);
      newContact.followUp.normalIntervalDays = values.normalIntervalDays;
      newContact.followUp.specificDate = values.specificDate;
      newContact.followUp.specificTime = values.specificDate ? values.specificTime : "";
      nextContacts = [...appState.contacts, newContact];
    }

    appState = persistence.save({ ...appState, contacts: nextContacts });
    contactEditor = null;
    renderActiveScreen();
  }

  function readInteractionForm(form) {
    const formData = new FormData(form);
    const requestedType = textOrEmpty(formData.get("type"));
    const type = ["successfulContact", "attemptedContact", "conductedStudy", "missedStudy"].includes(requestedType) ? requestedType : "attemptedContact";
    const successful = type === "successfulContact" || type === "conductedStudy";
    return {
      type,
      date: textOrEmpty(formData.get("date")),
      time: textOrEmpty(formData.get("time")),
      discussionNotes: successful ? textOrEmpty(formData.get("discussionNotes")).trim() : "",
      scriptures: successful ? textOrEmpty(formData.get("scriptures")).trim() : "",
      literature: type === "successfulContact" ? textOrEmpty(formData.get("literature")).trim() : "",
      note: type === "attemptedContact" || type === "missedStudy" ? textOrEmpty(formData.get("note")).trim() : "",
      studyProgress: type === "conductedStudy" ? textOrEmpty(formData.get("studyProgress")).trim() : "",
      nextFollowUpMode: textOrEmpty(formData.get("nextFollowUpMode")),
      nextSpecificDate: textOrEmpty(formData.get("nextSpecificDate")),
      nextSpecificTime: textOrEmpty(formData.get("nextSpecificTime")),
      nextStudyMode: textOrEmpty(formData.get("nextStudyMode")),
      nextStudyDate: textOrEmpty(formData.get("nextStudyDate")),
      nextStudyTime: textOrEmpty(formData.get("nextStudyTime"))
    };
  }

  function saveInteraction(form) {
    const contact = appState.contacts.find((item) => item.id === activeContactId);
    if (!contact) return;
    const values = readInteractionForm(form);
    const dateInput = form.elements.date;
    const dateError = form.querySelector("#date-error");
    if (!values.date) {
      dateInput.setAttribute("aria-invalid", "true");
      dateError.hidden = false;
      dateInput.focus();
      return;
    }

    if (!interactionEditor.entryId && values.type === "successfulContact" && values.nextFollowUpMode === "specific" && !values.nextSpecificDate) {
      const nextDateInput = form.elements.nextSpecificDate;
      nextDateInput.setAttribute("aria-invalid", "true");
      form.querySelector("#next-date-error").hidden = false;
      nextDateInput.focus();
      return;
    }
    if (!interactionEditor.entryId && (values.type === "conductedStudy" || values.type === "missedStudy") && values.nextStudyMode === "specific" && !values.nextStudyDate) {
      const nextDateInput = form.elements.nextStudyDate;
      nextDateInput.setAttribute("aria-invalid", "true");
      form.querySelector("#next-study-date-error").hidden = false;
      nextDateInput.focus();
      return;
    }

    const now = new Date().toISOString();
    let nextHistory;
    if (interactionEditor.entryId) {
      nextHistory = contact.history.map((entry) => entry.id === interactionEditor.entryId ? { ...entry, ...values, updatedAt: now } : entry);
    } else {
      nextHistory = [...contact.history, { id: createId("history"), ...values, createdAt: now, updatedAt: now }];
    }

    const shouldApplyNextDecision = !interactionEditor.entryId && values.type === "successfulContact";
    const shouldApplyStudyDecision = !interactionEditor.entryId && (values.type === "conductedStudy" || values.type === "missedStudy");
    const nextContacts = appState.contacts.map((item) => item.id === contact.id ? {
      ...item,
      history: nextHistory,
      followUp: shouldApplyNextDecision ? {
        ...item.followUp,
        specificDate: values.nextFollowUpMode === "specific" ? values.nextSpecificDate : "",
        specificTime: values.nextFollowUpMode === "specific" ? values.nextSpecificTime : ""
      } : item.followUp,
      bibleStudy: shouldApplyStudyDecision ? {
        ...item.bibleStudy,
        progress: values.type === "conductedStudy" && values.studyProgress ? values.studyProgress : item.bibleStudy.progress,
        specificDate: values.nextStudyMode === "specific" ? values.nextStudyDate : "",
        specificTime: values.nextStudyMode === "specific" ? values.nextStudyTime : ""
      } : item.bibleStudy,
      updatedAt: now
    } : item);
    appState = persistence.save({ ...appState, contacts: nextContacts });
    interactionEditor = null;
    renderActiveScreen();
  }

  function deleteInteraction(entryId) {
    const contact = appState.contacts.find((item) => item.id === activeContactId);
    const entry = contact?.history.find((item) => item.id === entryId);
    if (!contact || !entry) return;
    const entryLabels = { successfulContact: "successful contact", attemptedContact: "attempted contact", conductedStudy: "conducted study", missedStudy: "missed/attempted study" };
    const confirmed = window.confirm(`Delete this ${entryLabels[entry.type] || "history entry"} from ${formatDate(entry.date, entry.time)}?\n\nThis cannot be undone.`);
    if (!confirmed) return;
    const nextContacts = appState.contacts.map((item) => item.id === contact.id
      ? { ...item, history: item.history.filter((historyEntry) => historyEntry.id !== entryId), updatedAt: new Date().toISOString() }
      : item);
    appState = persistence.save({ ...appState, contacts: nextContacts });
    renderActiveScreen();
  }

  function saveStudyLifecycle(form, isEnding) {
    const contact = appState.contacts.find((item) => item.id === activeContactId);
    if (!contact) return;
    const formData = new FormData(form);
    const now = new Date().toISOString();
    let updatedContact;

    if (isEnding) {
      const intervalSelection = textOrEmpty(formData.get("intervalSelection"));
      const customInterval = Number.parseInt(textOrEmpty(formData.get("customIntervalDays")), 10);
      const normalIntervalDays = intervalSelection === "custom" ? customInterval : intervalSelection === "none" ? null : Number.parseInt(intervalSelection, 10);
      const specificDate = textOrEmpty(formData.get("specificDate"));
      const specificTime = textOrEmpty(formData.get("specificTime"));
      if (intervalSelection === "custom" && (!Number.isInteger(normalIntervalDays) || normalIntervalDays < 1 || normalIntervalDays > 3650)) {
        form.elements.customIntervalDays.setAttribute("aria-invalid", "true");
        form.querySelector("#interval-error").hidden = false;
        form.elements.customIntervalDays.focus();
        return;
      }
      if (specificTime && !specificDate) {
        form.elements.specificDate.setAttribute("aria-invalid", "true");
        form.querySelector("#specific-date-error").hidden = false;
        form.elements.specificDate.focus();
        return;
      }
      updatedContact = { ...contact, relationshipType: "followUp", followUp: { ...contact.followUp, normalIntervalDays, specificDate, specificTime: specificDate ? specificTime : "" }, bibleStudy: { ...contact.bibleStudy, isActive: false, specificDate: "", specificTime: "" }, updatedAt: now };
    } else {
      const normalDay = textOrEmpty(formData.get("normalDay"));
      const normalTime = textOrEmpty(formData.get("normalTime"));
      const specificDate = textOrEmpty(formData.get("specificDate"));
      const specificTime = textOrEmpty(formData.get("specificTime"));
      if (normalTime && normalDay === "") {
        form.elements.normalDay.setAttribute("aria-invalid", "true");
        form.querySelector("#study-day-error").hidden = false;
        form.elements.normalDay.focus();
        return;
      }
      if (specificTime && !specificDate) {
        form.elements.specificDate.setAttribute("aria-invalid", "true");
        form.querySelector("#study-specific-date-error").hidden = false;
        form.elements.specificDate.focus();
        return;
      }
      updatedContact = { ...contact, relationshipType: "bibleStudy", bibleStudy: { ...contact.bibleStudy, isActive: true, normalDay, normalTime: normalDay ? normalTime : "", location: textOrEmpty(formData.get("location")).trim(), publication: textOrEmpty(formData.get("publication")).trim(), progress: textOrEmpty(formData.get("progress")).trim(), specificDate, specificTime: specificDate ? specificTime : "" }, updatedAt: now };
    }

    appState = persistence.save({ ...appState, contacts: appState.contacts.map((item) => item.id === contact.id ? updatedContact : item) });
    studyLifecycleEditor = null;
    renderActiveScreen();
  }

  function savePause(form) {
    const contact = appState.contacts.find((item) => item.id === activeContactId);
    if (!contact) return;
    const formData = new FormData(form);
    const status = formData.get("pauseStatus") === "indefinite" ? "indefinite" : "untilDate";
    const untilDate = textOrEmpty(formData.get("pauseUntilDate"));
    const reason = textOrEmpty(formData.get("pauseReason")).trim();

    if (status === "untilDate" && (!untilDate || untilDate <= todayDateValue())) {
      const dateInput = form.elements.pauseUntilDate;
      dateInput.setAttribute("aria-invalid", "true");
      form.querySelector("#pause-date-error").hidden = false;
      dateInput.focus();
      return;
    }

    const nextContacts = appState.contacts.map((item) => item.id === contact.id ? {
      ...item,
      pause: { status, untilDate: status === "untilDate" ? untilDate : "", reason },
      updatedAt: new Date().toISOString()
    } : item);
    appState = persistence.save({ ...appState, contacts: nextContacts });
    pauseEditor = false;
    renderActiveScreen();
  }

  function resumeContact(contactId) {
    const contact = appState.contacts.find((item) => item.id === contactId);
    if (!contact) return;
    const confirmed = window.confirm(`Resume scheduling for ${contact.name}?`);
    if (!confirmed) return;
    const nextContacts = appState.contacts.map((item) => item.id === contact.id ? {
      ...item,
      pause: { status: "active", untilDate: "", reason: "" },
      updatedAt: new Date().toISOString()
    } : item);
    appState = persistence.save({ ...appState, contacts: nextContacts });
    renderActiveScreen();
  }

  function deleteContact(contactId) {
    const contact = appState.contacts.find((item) => item.id === contactId);
    if (!contact) return;
    const confirmed = window.confirm(`Delete ${contact.name}?\n\nThis permanently removes the entire contact record and cannot be undone.`);
    if (!confirmed) return;
    appState = persistence.save({ ...appState, contacts: appState.contacts.filter((item) => item.id !== contactId) });
    if (activeContactId === contactId) activeContactId = null;
    renderActiveScreen();
  }

  function handleAction(actionElement) {
    const { action, contactId } = actionElement.dataset;
    if (action === "open-contacts") selectScreen("contacts");
    if (action === "open-home-contact") {
      activeScreen = "contacts";
      activeContactId = contactId;
      contactEditor = null;
      interactionEditor = null;
      pauseEditor = false;
      studyLifecycleEditor = null;
      showPausedOnly = false;
      renderActiveScreen();
      mainElement.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "auto" });
    }
    if (action === "new-contact") {
      activeContactId = null;
      contactSearchQuery = "";
      contactEditor = { contactId: null };
      renderActiveScreen();
      mainElement.querySelector("#contact-name")?.focus();
    }
    if (action === "toggle-paused-view") {
      showPausedOnly = !showPausedOnly;
      renderActiveScreen();
    }
    if (action === "clear-contact-search") {
      contactSearchQuery = "";
      renderActiveScreen();
      mainElement.querySelector("#contact-search")?.focus();
    }
    if (action === "edit-contact") {
      activeContactId = contactId;
      contactEditor = { contactId };
      renderActiveScreen();
      mainElement.querySelector("#contact-name")?.focus();
    }
    if (action === "cancel-contact") {
      contactEditor = null;
      renderActiveScreen();
    }
    if (action === "open-contact") {
      activeContactId = contactId;
      interactionEditor = null;
      pauseEditor = false;
      studyLifecycleEditor = null;
      renderActiveScreen();
    }
    if (action === "open-study") {
      activeScreen = "studies";
      activeContactId = contactId;
      interactionEditor = null;
      pauseEditor = false;
      studyLifecycleEditor = null;
      renderActiveScreen();
    }
    if (action === "back-to-list") {
      activeContactId = null;
      interactionEditor = null;
      pauseEditor = false;
      studyLifecycleEditor = null;
      renderActiveScreen();
    }
    if (action === "add-successful" || action === "add-attempted") {
      interactionEditor = { type: action === "add-successful" ? "successfulContact" : "attemptedContact", entryId: null };
      renderActiveScreen();
      mainElement.querySelector("#interaction-date")?.focus();
    }
    if (action === "add-conducted-study" || action === "add-missed-study") {
      interactionEditor = { type: action === "add-conducted-study" ? "conductedStudy" : "missedStudy", entryId: null };
      renderActiveScreen();
      mainElement.querySelector("#interaction-date")?.focus();
    }
    if (action === "edit-interaction") {
      const contact = appState.contacts.find((item) => item.id === activeContactId);
      const entry = contact?.history.find((item) => item.id === actionElement.dataset.entryId);
      if (entry) {
        interactionEditor = { type: entry.type, entryId: entry.id };
        renderActiveScreen();
      }
    }
    if (action === "cancel-interaction") {
      interactionEditor = null;
      renderActiveScreen();
    }
    if (action === "pause-contact") {
      activeContactId = contactId;
      pauseEditor = true;
      interactionEditor = null;
      renderActiveScreen();
    }
    if (action === "cancel-pause") {
      pauseEditor = false;
      renderActiveScreen();
    }
    if (action === "start-study" || action === "edit-study" || action === "end-study") {
      activeContactId = contactId;
      studyLifecycleEditor = action === "end-study" ? "end" : "start";
      interactionEditor = null;
      pauseEditor = false;
      renderActiveScreen();
    }
    if (action === "cancel-study-lifecycle") {
      studyLifecycleEditor = null;
      renderActiveScreen();
    }
    if (action === "resume-contact") resumeContact(contactId);
    if (action === "export-backup") exportBackup();
    if (action === "cancel-restore") cancelRestore();
    if (action === "confirm-restore") commitRestore();
    if (action === "delete-interaction") deleteInteraction(actionElement.dataset.entryId);
    if (action === "delete-contact") deleteContact(contactId);
  }

  function registerInteractions() {
    navigationElement.addEventListener("click", (event) => {
      const button = event.target.closest("[data-screen]");
      if (button) selectScreen(button.dataset.screen);
    });
    mainElement.addEventListener("click", (event) => {
      const actionElement = event.target.closest("[data-action]");
      if (actionElement) handleAction(actionElement);
    });
    mainElement.addEventListener("submit", (event) => {
      if (event.target.id === "contact-form") {
        event.preventDefault();
        saveContact(event.target);
      }
      if (event.target.id === "interaction-form") {
        event.preventDefault();
        saveInteraction(event.target);
      }
      if (event.target.id === "pause-form") {
        event.preventDefault();
        savePause(event.target);
      }
      if (event.target.id === "start-study-form") {
        event.preventDefault();
        saveStudyLifecycle(event.target, false);
      }
      if (event.target.id === "end-study-form") {
        event.preventDefault();
        saveStudyLifecycle(event.target, true);
      }
    });
    mainElement.addEventListener("input", (event) => {
      if (event.target.name === "contactSearch") {
        contactSearchQuery = event.target.value;
        const results = renderContactResults();
        const resultsElement = mainElement.querySelector("#contact-results");
        const countElement = mainElement.querySelector("#contact-result-count");
        if (resultsElement) resultsElement.innerHTML = results.markup;
        if (countElement) countElement.textContent = results.countText;
      }
      if (event.target.name === "reportMonth" && /^\d{4}-\d{2}$/.test(event.target.value)) {
        reportMonth = event.target.value;
        renderActiveScreen();
      }
      if (event.target.name === "name" && event.target.value.trim()) {
        event.target.removeAttribute("aria-invalid");
        const error = mainElement.querySelector("#name-error");
        if (error) error.hidden = true;
      }
      if (event.target.name === "date" && event.target.value) {
        event.target.removeAttribute("aria-invalid");
        const error = mainElement.querySelector("#date-error");
        if (error) error.hidden = true;
      }
      if (event.target.name === "customIntervalDays" && event.target.value) {
        event.target.removeAttribute("aria-invalid");
        const error = mainElement.querySelector("#interval-error");
        if (error) error.hidden = true;
      }
      if (event.target.name === "specificDate" && event.target.value) {
        event.target.removeAttribute("aria-invalid");
        const error = mainElement.querySelector("#specific-date-error");
        if (error) error.hidden = true;
        const studyError = mainElement.querySelector("#study-specific-date-error");
        if (studyError) studyError.hidden = true;
      }
      if (event.target.name === "nextSpecificDate" && event.target.value) {
        event.target.removeAttribute("aria-invalid");
        const error = mainElement.querySelector("#next-date-error");
        if (error) error.hidden = true;
      }
      if (event.target.name === "nextStudyDate" && event.target.value) {
        event.target.removeAttribute("aria-invalid");
        const error = mainElement.querySelector("#next-study-date-error");
        if (error) error.hidden = true;
      }
      if (event.target.name === "normalDay" && event.target.value !== "") {
        event.target.removeAttribute("aria-invalid");
        const error = mainElement.querySelector("#study-day-error");
        if (error) error.hidden = true;
      }
      if (event.target.name === "pauseUntilDate" && event.target.value > todayDateValue()) {
        event.target.removeAttribute("aria-invalid");
        const error = mainElement.querySelector("#pause-date-error");
        if (error) error.hidden = true;
      }
    });
    mainElement.addEventListener("change", (event) => {
      if (event.target.name === "restoreFile") {
        stageRestoreFile(event.target.files?.[0]);
      }
      if (event.target.name === "intervalSelection") {
        const customFields = mainElement.querySelector("[data-custom-interval]");
        if (customFields) customFields.hidden = event.target.value !== "custom";
      }
      if (event.target.name === "nextFollowUpMode") {
        const specificFields = mainElement.querySelector("[data-interaction-specific]");
        if (specificFields) specificFields.hidden = event.target.value !== "specific";
      }
      if (event.target.name === "nextStudyMode") {
        const specificFields = mainElement.querySelector("[data-study-specific]");
        if (specificFields) specificFields.hidden = event.target.value !== "specific";
      }
      if (event.target.name === "pauseStatus") {
        const dateFields = mainElement.querySelector("[data-pause-date]");
        if (dateFields) dateFields.hidden = event.target.value !== "untilDate";
      }
    });
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;

    let isReloadingForUpdate = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (isReloadingForUpdate) return;
      isReloadingForUpdate = true;
      window.location.reload();
    });

    window.addEventListener("load", async () => {
      try {
        const registration = await navigator.serviceWorker.register("./service-worker.js");
        await registration.update();
      }
      catch (error) { console.error("Offline support could not be activated.", error); }
    });
  }

  function initialize() {
    try {
      appState = persistence.load();
      if (saveStatusElement.dataset.warning !== "true") setSaveStatus("Saved on device");
    } catch (error) {
      console.error("Local storage is unavailable.", error);
      appState = createDefaultState();
      setSaveStatus("Storage unavailable", true);
    }
    registerInteractions();
    renderActiveScreen();
    registerServiceWorker();
  }

  initialize();
})();
