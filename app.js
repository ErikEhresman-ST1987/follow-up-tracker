(function () {
  "use strict";

  const DATA_VERSION = 1;
  const STORAGE_KEY = "followUpTracker.appData";
  const VALID_SCREENS = new Set(["home", "contacts", "studies", "report", "data"]);

  let appState = createDefaultState();
  let activeScreen = "home";
  let contactEditor = null;

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
      history: Array.isArray(candidate.history) ? candidate.history : [],
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

  function renderSummaryCard(label) {
    return `<article class="summary-card"><span class="summary-card__value">0</span><span class="summary-card__label">${label}</span></article>`;
  }

  function renderDeferredScreen(title, message) {
    const titleId = `${title.toLowerCase().replaceAll(" ", "-")}-title`;
    return `<section aria-labelledby="${titleId}"><header class="screen-heading"><h2 id="${titleId}">${title}</h2></header><article class="empty-state"><p class="section-label">Planned core feature</p><h3>Not active yet</h3><p>${message}</p></article></section>`;
  }

  function renderContactForm() {
    const contact = contactEditor?.contactId ? appState.contacts.find((item) => item.id === contactEditor.contactId) : null;
    const isEditing = Boolean(contact);
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

  function renderContactCard(contact) {
    const details = [contact.address, contact.phone, contact.email].filter(Boolean);
    return `
      <article class="contact-card">
        <div class="contact-card__body">
          <h3>${escapeHtml(contact.name)}</h3>
          ${details.length ? `<div class="contact-details">${details.map((detail) => `<p>${escapeHtml(detail)}</p>`).join("")}</div>` : `<p class="muted-text">No contact details added.</p>`}
          ${contact.generalNote ? `<p class="contact-note">${escapeHtml(contact.generalNote)}</p>` : ""}
        </div>
        <div class="contact-card__actions">
          <button class="button button--secondary" type="button" data-action="edit-contact" data-contact-id="${escapeHtml(contact.id)}">Edit</button>
          <button class="button button--danger-subtle" type="button" data-action="delete-contact" data-contact-id="${escapeHtml(contact.id)}">Delete</button>
        </div>
      </article>`;
  }

  const screenRenderers = {
    home() {
      const contactCount = appState.contacts.length;
      return `
        <section aria-labelledby="home-title">
          <header class="screen-heading"><h2 id="home-title">Needs Follow-Up</h2><p>Scheduling begins in Increment 4. Contact records are available now.</p></header>
          <div class="summary-grid" aria-label="Follow-up summary">${renderSummaryCard("Overdue")}${renderSummaryCard("Due today")}${renderSummaryCard("Upcoming")}</div>
          <article class="empty-state">
            <p class="section-label">Contacts</p>
            <h3>${contactCount === 0 ? "No contacts yet" : `${contactCount} ${contactCount === 1 ? "contact" : "contacts"} saved`}</h3>
            <p>${contactCount === 0 ? "Add your first contact from the Contacts screen." : "Scheduling and interaction history will be added in the next development increments."}</p>
            <button class="button button--primary button--spaced" type="button" data-action="open-contacts">${contactCount === 0 ? "Add a Contact" : "View Contacts"}</button>
          </article>
        </section>`;
    },
    contacts() {
      if (contactEditor) return renderContactForm();
      const contacts = sortedContacts();
      return `
        <section aria-labelledby="contacts-title">
          <header class="screen-heading screen-heading--actions">
            <div><h2 id="contacts-title">Contacts</h2><p>${contacts.length === 0 ? "Create the first permanent contact record." : `${contacts.length} ${contacts.length === 1 ? "person" : "people"}`}</p></div>
            <button class="button button--primary" type="button" data-action="new-contact">Add Contact</button>
          </header>
          ${contacts.length === 0 ? `<article class="empty-state"><p class="section-label">Ready to begin</p><h3>No contacts yet</h3><p>Add a person’s permanent information here. Interaction history begins in Increment 3.</p></article>` : `<div class="contact-list">${contacts.map(renderContactCard).join("")}</div>`}
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
    renderActiveScreen();
    mainElement.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function readContactForm(form) {
    const formData = new FormData(form);
    return {
      name: textOrEmpty(formData.get("name")).trim(),
      address: textOrEmpty(formData.get("address")).trim(),
      phone: textOrEmpty(formData.get("phone")).trim(),
      email: textOrEmpty(formData.get("email")).trim(),
      generalNote: textOrEmpty(formData.get("generalNote")).trim()
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

    const now = new Date().toISOString();
    let nextContacts;
    if (contactEditor?.contactId) {
      nextContacts = appState.contacts.map((contact) => contact.id === contactEditor.contactId ? { ...contact, ...values, updatedAt: now } : contact);
    } else {
      nextContacts = [...appState.contacts, createContact(values)];
    }

    appState = persistence.save({ ...appState, contacts: nextContacts });
    contactEditor = null;
    renderActiveScreen();
  }

  function deleteContact(contactId) {
    const contact = appState.contacts.find((item) => item.id === contactId);
    if (!contact) return;
    const confirmed = window.confirm(`Delete ${contact.name}?\n\nThis permanently removes the entire contact record and cannot be undone.`);
    if (!confirmed) return;
    appState = persistence.save({ ...appState, contacts: appState.contacts.filter((item) => item.id !== contactId) });
    renderActiveScreen();
  }

  function handleAction(actionElement) {
    const { action, contactId } = actionElement.dataset;
    if (action === "open-contacts") selectScreen("contacts");
    if (action === "new-contact") {
      contactEditor = { contactId: null };
      renderActiveScreen();
      mainElement.querySelector("#contact-name")?.focus();
    }
    if (action === "edit-contact") {
      contactEditor = { contactId };
      renderActiveScreen();
      mainElement.querySelector("#contact-name")?.focus();
    }
    if (action === "cancel-contact") {
      contactEditor = null;
      renderActiveScreen();
    }
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
      if (event.target.id !== "contact-form") return;
      event.preventDefault();
      saveContact(event.target);
    });
    mainElement.addEventListener("input", (event) => {
      if (event.target.name === "name" && event.target.value.trim()) {
        event.target.removeAttribute("aria-invalid");
        const error = mainElement.querySelector("#name-error");
        if (error) error.hidden = true;
      }
    });
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", async () => {
      try { await navigator.serviceWorker.register("./service-worker.js"); }
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
