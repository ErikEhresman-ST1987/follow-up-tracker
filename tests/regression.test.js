"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const appPath = path.join(__dirname, "..", "app.js");
const source = fs.readFileSync(appPath, "utf8").replace(
  "  initialize();",
  `  globalThis.__rules = {
    createDefaultState,
    normalizeState,
    validateBackupDocument,
    deriveLastContact,
    deriveNextFollowUp,
    deriveMonthlyReport,
    getFollowUpGroups,
    isActivelyPaused,
    addDays,
    todayDateValue,
    setState(nextState) { appState = normalizeState(nextState); },
    getState() { return appState; }
  };`
);

const elementStub = () => ({
  dataset: {},
  textContent: "",
  addEventListener() {},
  querySelectorAll() { return []; }
});

const storage = new Map();
const context = {
  console,
  crypto: webcrypto,
  Date,
  Intl,
  URL,
  Blob,
  FormData,
  setTimeout,
  clearTimeout,
  document: { querySelector: elementStub, createElement: elementStub, body: { append() {} } },
  navigator: {},
  localStorage: {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); }
  },
  window: {
    confirm() { return true; },
    alert() {},
    addEventListener() {},
    scrollTo() {},
    location: { reload() {} },
    setTimeout
  }
};
context.globalThis = context;
vm.runInNewContext(source, context, { filename: appPath });

const rules = context.__rules;
const today = rules.todayDateValue();

function history(id, type, date, time = "") {
  return {
    id,
    type,
    date,
    time,
    discussionNotes: "",
    scriptures: "",
    literature: "",
    note: "",
    studyProgress: "",
    createdAt: "",
    updatedAt: ""
  };
}

function contact(id, name, overrides = {}) {
  return {
    id,
    name,
    address: "",
    phone: "",
    email: "",
    generalNote: "",
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
    createdAt: "",
    updatedAt: "",
    ...overrides
  };
}

function state(contacts) {
  return { dataVersion: 1, settings: {}, contacts };
}

function test(name, callback) {
  try {
    callback();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("attempts do not replace Last Contact or reset the interval", () => {
  const fred = contact("fred", "Fred", {
    followUp: { normalIntervalDays: 14, specificDate: "", specificTime: "" },
    history: [
      history("fred-success", "successfulContact", "2026-09-01"),
      history("fred-attempt", "attemptedContact", "2026-09-18")
    ]
  });
  assert.equal(rules.deriveLastContact(fred).id, "fred-success");
  assert.deepEqual(
    JSON.parse(JSON.stringify(rules.deriveNextFollowUp(fred, "2026-09-19"))),
    { status: "scheduled", source: "normal", date: "2026-09-15", time: "" }
  );
});

test("specific arrangements override but do not replace the normal interval", () => {
  const fred = contact("fred", "Fred", {
    followUp: { normalIntervalDays: 14, specificDate: "2026-09-24", specificTime: "18:30" },
    history: [history("fred-success", "successfulContact", "2026-09-01")]
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(rules.deriveNextFollowUp(fred, "2026-09-19"))),
    { status: "scheduled", source: "specific", date: "2026-09-24", time: "18:30" }
  );
  assert.equal(fred.followUp.normalIntervalDays, 14);
});

test("timed and indefinite pauses suppress Needs Follow-Up", () => {
  const scheduled = { normalIntervalDays: null, specificDate: today, specificTime: "" };
  const timed = contact("timed", "Timed", { followUp: scheduled, pause: { status: "untilDate", untilDate: rules.addDays(today, 2), reason: "Away" } });
  const indefinite = contact("indefinite", "Indefinite", { followUp: scheduled, pause: { status: "indefinite", untilDate: "", reason: "Space" } });
  assert.equal(rules.isActivelyPaused(timed), true);
  assert.equal(rules.deriveNextFollowUp(timed).status, "paused");
  assert.equal(rules.deriveNextFollowUp(indefinite).status, "paused");
});

test("Needs Follow-Up orders older overdue contacts first", () => {
  const older = contact("older", "Older", { followUp: { normalIntervalDays: null, specificDate: rules.addDays(today, -8), specificTime: "" } });
  const newer = contact("newer", "Newer", { followUp: { normalIntervalDays: null, specificDate: rules.addDays(today, -2), specificTime: "" } });
  const due = contact("due", "Due", { followUp: { normalIntervalDays: null, specificDate: today, specificTime: "09:00" } });
  const upcoming = contact("upcoming", "Upcoming", { followUp: { normalIntervalDays: null, specificDate: rules.addDays(today, 3), specificTime: "" } });
  rules.setState(state([newer, upcoming, due, older]));
  const groups = rules.getFollowUpGroups();
  assert.deepEqual(Array.from(groups.overdue, (item) => item.contact.id), ["older", "newer"]);
  assert.deepEqual(Array.from(groups.today, (item) => item.contact.id), ["due"]);
  assert.deepEqual(Array.from(groups.upcoming, (item) => item.contact.id), ["upcoming"]);
});

test("Bible Study scheduling honors a one-time arrangement", () => {
  const study = contact("study", "Study", {
    relationshipType: "bibleStudy",
    bibleStudy: {
      isActive: true,
      normalDay: "2",
      normalTime: "18:30",
      location: "Their home",
      publication: "Example publication",
      progress: "Lesson 4",
      specificDate: "2026-09-25",
      specificTime: "19:00"
    },
    history: [history("study-one", "conductedStudy", "2026-09-15")]
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(rules.deriveNextFollowUp(study, "2026-09-19"))),
    { status: "scheduled", source: "studySpecific", date: "2026-09-25", time: "19:00" }
  );
  assert.equal(rules.deriveLastContact(study).id, "study-one");
});

test("the representative monthly report is 9 follow-ups and 2 studies", () => {
  const month = "2026-09";
  const fred = contact("fred", "Fred", { history: [1, 2, 3, 4].map((day) => history(`fred-${day}`, "conductedStudy", `${month}-0${day}`)) });
  const wilma = contact("wilma", "Wilma", { history: [5, 6, 7].map((day) => history(`wilma-${day}`, "conductedStudy", `${month}-0${day}`)) });
  const george = contact("george", "George", { history: [8, 9].map((day) => history(`george-${day}`, "successfulContact", `${month}-0${day}`)) });
  fred.history.push(history("fred-attempt", "missedStudy", `${month}-10`));
  george.history.push(history("george-attempt", "attemptedContact", `${month}-11`));
  rules.setState(state([fred, wilma, george]));
  assert.deepEqual(JSON.parse(JSON.stringify(rules.deriveMonthlyReport(month))), { followUpsMade: 9, bibleStudiesConducted: 2 });
});

test("backup validation preserves the complete authoritative dataset", () => {
  const appData = rules.getState();
  const backup = {
    backupFormatVersion: 1,
    backupCreatedAt: "2026-09-19T12:00:00.000Z",
    appDataVersion: 1,
    appData
  };
  const restored = rules.validateBackupDocument(backup);
  assert.deepEqual(JSON.parse(JSON.stringify(restored)), JSON.parse(JSON.stringify(appData)));
  assert.throws(() => rules.validateBackupDocument({ ...backup, backupFormatVersion: 2 }), /not supported/);
  assert.throws(() => rules.validateBackupDocument({ ...backup, appData: { ...appData, contacts: [...appData.contacts, appData.contacts[0]] } }), /duplicate contact IDs/);
});

console.log("All Follow-Up Tracker operational-core regression tests passed.");
