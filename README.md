# Follow-Up Tracker

Follow-Up Tracker is a private, local-first application for recording ministry follow-ups and Bible studies. Its core promise is: open the app and immediately know who needs attention, what happened previously, and what should happen next.

## Current status

Increment 1 — Foundation is implemented, activated, and verified.

This increment is not the usable application. Contact management begins in Increment 2, and the first real-world trial begins only after the complete functional core has passed regression testing.

Next exact step: Increment 2 — create, edit, and deliberately delete contacts and their permanent contact information.

## Governing principles

- Lightweight, mobile-first, local-first, and offline-capable.
- Plain HTML, CSS, and JavaScript with no framework or external service.
- Store facts once and derive secondary information whenever practical.
- One authoritative owner for state, persistence, scheduling, reporting, and rendering responsibilities.
- Add complexity only when a demonstrated requirement earns it.
- Use fictional information in development and repository examples.

## File responsibilities

- `index.html` — stable application shell and primary navigation.
- `styles.css` — responsive, touch-friendly presentation.
- `app.js` — initialization, authoritative in-memory state, persistence owner, interaction routing, and active-screen rendering.
- `manifest.json` — installable PWA metadata.
- `service-worker.js` — versioned application-shell caching for offline loading.
- `icons/` — local application icons.

## Data and ownership

- Storage key: `followUpTracker.appData`
- Current data version: `1`
- Backup-format version: not active until Increment 10
- Authoritative application state: one in-memory `appState` object
- Persistence: one `persistence` boundary in `app.js` owns load, normalization, and save behavior
- Initial state shape:

```json
{
  "dataVersion": 1,
  "settings": {},
  "contacts": []
}
```

Each future contact and history entry will have a stable internal ID. Names will not be identifiers.

## Known destination rules

Scheduling precedence will be implemented in one rules layer:

1. Pause state
2. Specific next follow-up
3. Normal follow-up interval derived from the most recent successful interaction

History will distinguish successful contact, attempted contact, conducted Bible study, and missed/attempted Bible study. Last Contact and monthly reporting will be derived from history.

For a selected month:

- Follow-ups made counts every successful interaction, including every conducted study session.
- Bible studies conducted counts unique contacts with at least one conducted study session.

A Bible Study remains a state of the existing contact record, preserving the contact ID and continuous history when moving between Follow-Up and Bible Study.

## Offline behavior

The service worker caches the application shell. The first online load installs the offline files; later launches can load without a network connection. Ordinary browser use remains supported and installation is optional.

When an application-shell file changes, update `CACHE_NAME` in `service-worker.js` so installed copies activate the new shell reliably.

## Increment 1 verification

1. Open the deployed application while online.
2. Confirm Home opens to Needs Follow-Up and shows zero Overdue, Due Today, and Upcoming.
3. Open each navigation area and confirm only the selected screen is displayed.
4. Open Data and confirm Data Version 1, local-device storage, and zero contacts.
5. Reload and confirm the application returns without an error.
6. At phone width, confirm the bottom navigation remains reachable and the page has no horizontal scrolling.
7. At tablet/desktop width, confirm navigation moves below the header and content remains readable.
8. Install/add the app to the home screen after the first online load, close it, turn on airplane mode, and confirm it launches offline.

## Known limitations

- The operational contact workflow is intentionally not implemented yet.
- Backup and Restore are not active until Increment 10.
- Full iOS, Android, tablet, and desktop regression remains required before the first real-world release.
