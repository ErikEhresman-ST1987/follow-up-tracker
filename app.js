(function () {
  "use strict";

  const DATA_VERSION = 1;
  const STORAGE_KEY = "followUpTracker.appData";
  const VALID_SCREENS = new Set(["home", "contacts", "studies", "report", "data"]);

  let appState = createDefaultState();
  let activeScreen = "home";

  const mainElement = document.querySelector("#main-content");
  const saveStatusElement = document.querySelector("#save-status");
  const navigationElement = document.querySelector(".app-nav");

  function createDefaultState() {
    return { dataVersion: DATA_VERSION, settings: {}, contacts: [] };
  }

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function normalizeState(candidate) {
    if (!isPlainObject(candidate)) return createDefaultState();
    if (candidate.dataVersion !== DATA_VERSION) throw new Error("Unsupported saved-data version.");

    return {
      dataVersion: DATA_VERSION,
      settings: isPlainObject(candidate.settings) ? candidate.settings : {},
      contacts: Array.isArray(candidate.contacts) ? candidate.contacts : []
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
    }
  };

  function setSaveStatus(message, isWarning = false) {
    saveStatusElement.textContent = message;
    saveStatusElement.dataset.warning = String(isWarning);
  }

  function renderSummaryCard(label) {
    return `<article class="summary-card"><span class="summary-card__value">0</span><span class="summary-card__label">${label}</span></article>`;
  }

  function renderDeferredScreen(title, message) {
    const titleId = `${title.toLowerCase().replaceAll(" ", "-")}-title`;
    return `
      <section aria-labelledby="${titleId}">
        <header class="screen-heading"><h2 id="${titleId}">${title}</h2></header>
        <article class="empty-state">
          <p class="section-label">Planned core feature</p>
          <h3>Not active yet</h3>
          <p>${message}</p>
        </article>
      </section>`;
  }

  const screenRenderers = {
    home() {
      return `
        <section aria-labelledby="home-title">
          <header class="screen-heading">
            <h2 id="home-title">Needs Follow-Up</h2>
            <p>Your priority list will appear here once contact management and scheduling are added.</p>
          </header>
          <div class="summary-grid" aria-label="Follow-up summary">
            ${renderSummaryCard("Overdue")}${renderSummaryCard("Due today")}${renderSummaryCard("Upcoming")}
          </div>
          <article class="empty-state">
            <p class="section-label">Foundation ready</p>
            <h3>No contacts yet</h3>
            <p>Contact creation begins in Increment 2. This screen is already reserved for the app’s primary workflow.</p>
          </article>
        </section>`;
    },

    contacts() {
      return renderDeferredScreen("Contacts", "Contact records will be created, edited, and deliberately deleted here beginning in Increment 2.");
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
          <header class="screen-heading">
            <h2 id="data-title">Data &amp; Settings</h2>
            <p>Local persistence is active. Backup and Restore will be added as part of the complete functional core.</p>
          </header>
          <article class="panel">
            <p class="section-label">Foundation status</p>
            <dl class="status-list">
              <div class="status-row"><dt>Data version</dt><dd>${appState.dataVersion}</dd></div>
              <div class="status-row"><dt>Storage</dt><dd>On this device</dd></div>
              <div class="status-row"><dt>Contacts</dt><dd>${appState.contacts.length}</dd></div>
            </dl>
          </article>
          <p class="privacy-note">Future contact information and exported backups may contain private information. Keep backup files in a safe place.</p>
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
    if (!VALID_SCREENS.has(screenName) || screenName === activeScreen) return;
    activeScreen = screenName;
    renderActiveScreen();
    mainElement.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function registerInteractions() {
    navigationElement.addEventListener("click", (event) => {
      const button = event.target.closest("[data-screen]");
      if (button) selectScreen(button.dataset.screen);
    });
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", async () => {
      try {
        await navigator.serviceWorker.register("./service-worker.js");
      } catch (error) {
        console.error("Offline support could not be activated.", error);
      }
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
