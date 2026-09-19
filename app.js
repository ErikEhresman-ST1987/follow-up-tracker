(function () {
  "use strict";

  const DATA_VERSION = 1;
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

  function deriveNextFollowUp(contact, comparisonDate = todayDateValue()) {
    if (contact.pause.status === "indefinite") {
      return { status: "paused", source: "pause", date: "", time: "" };
    }
    if (contact.pause.status === "untilDate" && contact.pause.untilDate > comparisonDate) {
      return { status: "paused", source: "pause", date: contact.pause.untilDate, time: "" };
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
    const suffix = schedule.source === "specific" ? " · specific arrangement" : ` · ${contact.followUp.normalIntervalDays}-day interval`;
    return `${formatDate(schedule.date, schedule.time)}${suffix}`;
  }

  function renderSummaryCard(label, count) {
    return `<article class="summary-card"><span class="summary-card__value">${count}</span><span class="summary-card__label">${label}</span></article>`;
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
            ${schedule.source === "specific" ? `<span class="schedule-badge">Specific</span>` : ""}
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

  function renderHistoryEntry(entry) {
    const isSuccessful = isSuccessfulEntry(entry);
    const content = isSuccessful
      ? [entry.discussionNotes, entry.scriptures ? `Scripture(s): ${entry.scriptures}` : "", entry.literature ? `Literature: ${entry.literature}` : ""].filter(Boolean)
      : [entry.note].filter(Boolean);

    return `
      <article class="history-entry history-entry--${isSuccessful ? "successful" : "attempted"}">
        <div class="history-entry__heading">
          <div>
            <p class="history-entry__type">${isSuccessful ? "Successful Contact" : "Attempted Contact"}</p>
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
    const history = sortedHistory(contact);
    const lastContact = deriveLastContact(contact);
    const isPaused = isActivelyPaused(contact);
    return `
      <section aria-labelledby="contact-detail-title">
        <header class="screen-heading">
          <button class="back-button" type="button" data-action="back-to-contacts">← All Contacts</button>
          <div class="detail-title-row">
            <div>
              <h2 id="contact-detail-title">${escapeHtml(contact.name)}</h2>
              <p>Last Contact: ${lastContact ? escapeHtml(formatDate(lastContact.date, lastContact.time)) : "None recorded"}</p>
              <p>Next Follow-Up: ${escapeHtml(renderScheduleText(contact))}</p>
            </div>
            <div class="detail-actions">
              <button class="button ${isPaused ? "button--primary" : "button--secondary"}" type="button" data-action="${isPaused ? "resume-contact" : "pause-contact"}" data-contact-id="${escapeHtml(contact.id)}">${isPaused ? "Resume" : "Pause"}</button>
              <button class="button button--secondary" type="button" data-action="edit-contact" data-contact-id="${escapeHtml(contact.id)}">Edit Contact</button>
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

        <section class="history-section" aria-labelledby="history-title">
          <div class="history-section__heading">
            <div><p class="section-label">Continuous history</p><h3 id="history-title">Contact History</h3></div>
            <div class="history-actions">
              <button class="button button--primary" type="button" data-action="add-successful">Successful Contact</button>
              <button class="button button--secondary" type="button" data-action="add-attempted">Attempted Contact</button>
            </div>
          </div>
          ${history.length ? `<div class="history-list">${history.map(renderHistoryEntry).join("")}</div>` : `<article class="empty-state"><h3>No history yet</h3><p>Record a successful or attempted contact. Attempts remain visible but do not become Last Contact.</p></article>`}
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
          <div class="follow-up-item__title-row"><h3>${escapeHtml(contact.name)}</h3>${isPaused ? `<span class="pause-badge">Paused</span>` : ""}</div>
          <p class="contact-card__last">Last Contact: ${lastContact ? escapeHtml(formatDate(lastContact.date)) : "None recorded"}</p>
          <p class="contact-card__last">${isPaused ? escapeHtml(renderPauseText(contact)) : `Next Follow-Up: ${escapeHtml(renderScheduleText(contact))}`}</p>
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
      return renderDeferredScreen("Bible Studies", "Established Bible studies will remain part of each person’s single continuing record. This lifecycle arrives in Increment 8.");
    },
    report() {
      return renderDeferredScreen("Monthly Report", "Monthly totals will be calculated from authoritative contact history in Increment 9.");
    },
    data() {
      return `
        <section aria-labelledby="data-title">
          <header class="screen-heading"><h2 id="data-title">Data &amp; Settings</h2><p>Local persistence is active. Backup and Restore will be added as part of the complete functional core.</p></header>
          <article class="panel"><p class="section-label">Application status</p><dl class="status-list"><div class="status-row"><dt>Data version</dt><dd>${appState.dataVersion}</dd></div><div class="status-row"><dt>Storage</dt><dd>On this device</dd></div><div class="status-row"><dt>Contacts</dt><dd>${appState.contacts.length}</dd></div></dl></article>
          <p class="privacy-note">Contact information and future exported backups may contain private information. Keep the device and backup files secure.</p>
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
    const type = formData.get("type") === "successfulContact" ? "successfulContact" : "attemptedContact";
    return {
      type,
      date: textOrEmpty(formData.get("date")),
      time: textOrEmpty(formData.get("time")),
      discussionNotes: type === "successfulContact" ? textOrEmpty(formData.get("discussionNotes")).trim() : "",
      scriptures: type === "successfulContact" ? textOrEmpty(formData.get("scriptures")).trim() : "",
      literature: type === "successfulContact" ? textOrEmpty(formData.get("literature")).trim() : "",
      note: type === "attemptedContact" ? textOrEmpty(formData.get("note")).trim() : "",
      nextFollowUpMode: textOrEmpty(formData.get("nextFollowUpMode")),
      nextSpecificDate: textOrEmpty(formData.get("nextSpecificDate")),
      nextSpecificTime: textOrEmpty(formData.get("nextSpecificTime"))
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

    const now = new Date().toISOString();
    let nextHistory;
    if (interactionEditor.entryId) {
      nextHistory = contact.history.map((entry) => entry.id === interactionEditor.entryId ? { ...entry, ...values, updatedAt: now } : entry);
    } else {
      nextHistory = [...contact.history, { id: createId("history"), ...values, createdAt: now, updatedAt: now }];
    }

    const shouldApplyNextDecision = !interactionEditor.entryId && values.type === "successfulContact";
    const nextContacts = appState.contacts.map((item) => item.id === contact.id ? {
      ...item,
      history: nextHistory,
      followUp: shouldApplyNextDecision ? {
        ...item.followUp,
        specificDate: values.nextFollowUpMode === "specific" ? values.nextSpecificDate : "",
        specificTime: values.nextFollowUpMode === "specific" ? values.nextSpecificTime : ""
      } : item.followUp,
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
    const confirmed = window.confirm(`Delete this ${isSuccessfulEntry(entry) ? "successful contact" : "attempted contact"} from ${formatDate(entry.date, entry.time)}?\n\nThis cannot be undone.`);
    if (!confirmed) return;
    const nextContacts = appState.contacts.map((item) => item.id === contact.id
      ? { ...item, history: item.history.filter((historyEntry) => historyEntry.id !== entryId), updatedAt: new Date().toISOString() }
      : item);
    appState = persistence.save({ ...appState, contacts: nextContacts });
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
    const confirmed = window.confirm(`Resume follow-up for ${contact.name}?`);
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
      renderActiveScreen();
    }
    if (action === "back-to-contacts") {
      activeContactId = null;
      interactionEditor = null;
      pauseEditor = false;
      renderActiveScreen();
    }
    if (action === "add-successful" || action === "add-attempted") {
      interactionEditor = { type: action === "add-successful" ? "successfulContact" : "attemptedContact", entryId: null };
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
    if (action === "resume-contact") resumeContact(contactId);
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
      }
      if (event.target.name === "nextSpecificDate" && event.target.value) {
        event.target.removeAttribute("aria-invalid");
        const error = mainElement.querySelector("#next-date-error");
        if (error) error.hidden = true;
      }
      if (event.target.name === "pauseUntilDate" && event.target.value > todayDateValue()) {
        event.target.removeAttribute("aria-invalid");
        const error = mainElement.querySelector("#pause-date-error");
        if (error) error.hidden = true;
      }
    });
    mainElement.addEventListener("change", (event) => {
      if (event.target.name === "intervalSelection") {
        const customFields = mainElement.querySelector("[data-custom-interval]");
        if (customFields) customFields.hidden = event.target.value !== "custom";
      }
      if (event.target.name === "nextFollowUpMode") {
        const specificFields = mainElement.querySelector("[data-interaction-specific]");
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
