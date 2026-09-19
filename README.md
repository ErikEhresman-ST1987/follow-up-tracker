# Follow-Up Tracker

Follow-Up Tracker is a private, local-first application for recording ministry follow-ups and Bible studies. Its core promise is: open the app and immediately know who needs attention, what happened previously, and what should happen next.

## Current status

Increment 12 — Full Regression is implemented and awaiting final user acceptance. Increments 1–11 are verified.

The complete planned functional core now exists and has reached its first real-world release-candidate checkpoint.

Next exact step after final acceptance: begin limited real-world use with dependable backups and record only demonstrated thin points or defects.

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
- `tests/regression.test.js` — dependency-free operational-core regression checks using fictional data.

## Data and ownership

- Storage key: `followUpTracker.appData`
- Current data version: `1`
- Backup-format version: `1`
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

Each contact and history entry has a stable internal ID. Names are not identifiers. History is owned by its contact and stored as one continuous relationship history.

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

When a newly deployed service worker takes control, the open app reloads once so the active screen uses the new application shell rather than continuing to display an older cached release.

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

## Increment 2 verification

1. Open Contacts and add a fictional contact with only a name.
2. Add a second fictional contact using name, address, phone, email, and a multi-line General Note.
3. Confirm both contacts appear and the list remains readable.
4. Reload or fully close and reopen the app; confirm both records return unchanged.
5. Edit the first contact, add or change several fields, save, and reload again.
6. Try to save a contact with no name; confirm the app requires a name without losing other entered information.
7. Tap Delete on one contact, cancel the confirmation, and confirm the contact remains.
8. Delete that contact again and approve the confirmation; confirm only that record is removed.
9. Open Home and Data; confirm their contact totals match the remaining records.
10. Confirm the contact form and cards have no sideways scrolling on the intended phone and tablet layouts.

## Increment 3 verification

1. Open a fictional contact and confirm Last Contact initially says none recorded.
2. Record a successful contact with date, optional time, discussion notes, scripture, and literature.
3. Confirm it appears in history and becomes Last Contact.
4. Record an attempted contact on a later date with a brief note.
5. Confirm the attempt appears newest-first but does not replace Last Contact.
6. Reload or fully close and reopen the app; confirm both entries return unchanged.
7. Edit both entry types and confirm the corrections survive another reload.
8. Try saving an entry without a date; confirm the date is required without clearing the other fields.
9. Cancel deletion of one entry and confirm it remains.
10. Delete the successful entry deliberately and confirm Last Contact returns to none while the attempted entry remains.
11. Add two successful contacts on different dates and confirm Last Contact derives from the newer successful date.
12. Confirm the contact detail, entry forms, and history remain readable without sideways scrolling on phone and tablet layouts.

Status: verified.

## Increment 4 verification

1. Edit a fictional contact and set a 14-day Normal Interval with no specific date.
2. Confirm Next Follow-Up is derived as 14 days after the most recent successful contact.
3. Change the interval to 7, 21, and 30 days and confirm each recalculates correctly.
4. Choose Custom, enter a valid number such as 10, and confirm the calculated date.
5. Try an empty, zero, or excessive custom interval and confirm it is rejected without clearing the form.
6. Set a Specific Next Date and optional time; confirm it overrides the normal interval while leaving the normal interval unchanged.
7. Try entering a specific time without a specific date; confirm the form requires a date.
8. Record an attempted contact and confirm neither the specific arrangement nor the normal calculation changes.
9. Record a successful contact and choose Use normal interval; confirm the old specific arrangement clears and the normal interval resumes from the new successful date.
10. Record another successful contact and choose a new specific date/time; confirm the new specific arrangement takes precedence.
11. Edit the newest successful contact’s date while using a normal interval and confirm the derived next date moves with it.
12. Reload or completely reopen the app and confirm all schedule settings and displayed dates remain unchanged.
13. Confirm the scheduling fields remain readable without sideways scrolling on phone and tablet layouts.

Status: verified.

## Increment 5 verification

1. Create or edit fictional contacts so at least two are overdue by different amounts, one is due today, and two are upcoming.
2. Confirm Home orders the groups Overdue → Due Today → Upcoming.
3. Confirm the older/more overdue contact appears first in Overdue.
4. Confirm upcoming contacts appear in chronological order.
5. Give a due-today or upcoming specific appointment a time and confirm the time is clearly displayed.
6. Confirm a specific arrangement is visibly identified and overrides the person’s normal interval.
7. Record an attempted contact for an overdue person and confirm they remain overdue in the same position.
8. Record a successful contact using the normal interval and confirm the person moves to the appropriate future position.
9. Open a person directly from a Home card and confirm the correct contact detail appears.
10. Reload or completely reopen the app and confirm the groups, counts, and order remain correct.
11. Confirm a contact without any schedule does not appear on Home but remains available under Contacts.
12. Confirm the Home list has no sideways scrolling on phone and tablet layouts.

Status: verified. Testing also confirmed the installed-PWA update path after the automatic reload-on-activation correction.

## Increment 6 verification

1. Pause an overdue fictional contact until a future date; confirm the person disappears from Home and appears in the Paused Contacts view.
2. Open the paused contact and confirm Last Contact, history, normal interval, and any specific arrangement are unchanged.
3. Pause another contact indefinitely with a short reason; confirm the person disappears from Home and the reason appears on the contact record and contact card.
4. Reload or completely reopen the app; confirm both pause states remain intact.
5. Open Contacts and toggle between All Contacts and Paused; confirm All Contacts includes everyone and Paused includes only contacts whose pause is currently active.
6. Resume a paused contact, cancel the confirmation, and confirm the pause remains.
7. Resume the contact again and approve; confirm its existing schedule returns unchanged and it appears in the correct Home group.
8. Try to create a timed pause with today or an earlier date; confirm the app requires a future date without clearing the other fields.
9. Confirm a timed pause clearly shows its resume date and an indefinite pause clearly says Paused indefinitely.
10. Confirm pause forms, banners, cards, and controls have no sideways scrolling on phone and tablet layouts.
11. After loading the update online, launch the installed app offline and confirm pause information remains available.

Status: verified.

## Increment 7 verification

1. Confirm the Contacts screen remains alphabetized by name and shows clear alphabetical section headings.
2. Search using part of a fictional contact’s name with different capitalization; confirm the correct contact remains visible.
3. Search using part of a fictional street address; confirm the correct contact remains visible.
4. Search for text found only in General Note or contact history; confirm it does not produce a match.
5. Enter a search with no matches; confirm the empty result explains that search covers name and street address.
6. Clear the search and confirm the full alphabetical list returns.
7. Open Paused Contacts, search within that view, and confirm only currently paused matching contacts appear.
8. Open a contact with a phone number and tap Call; confirm the device offers the normal phone action without changing app data.
9. Tap Compose Email; confirm the normal mail composer opens with the saved address.
10. Tap Open in Maps; confirm the device/browser hands off the saved address for mapping without requiring an API key.
11. Confirm contacts missing any of these optional fields simply omit the corresponding action.
12. Reload or completely reopen the app and confirm contacts, pause states, schedules, and history remain unchanged.
13. Confirm the search field, alphabetical headings, cards, and contact-action controls have no sideways scrolling on phone and tablet layouts.
14. After loading the update online, launch the installed app offline and confirm alphabetical browsing and search still work. External call/email/maps handoffs may require the corresponding device service.

Status: verified.

## Increment 8 verification

1. Open a fictional Follow-Up contact with existing history and choose Establish Bible Study.
2. Add a normal study day/time, location, publication, and progress; confirm the same contact ID, permanent information, General Note, and earlier history remain intact.
3. Confirm the person appears in Bible Studies and is clearly marked as a Bible Study in Contacts and Home.
4. Confirm the normal recurring study appears on Home on the correct next weekday and displays its time.
5. Edit the study and add a specific upcoming date/time; confirm it overrides the normal schedule without replacing the saved normal day/time.
6. Record a Conducted Study with notes, scriptures, and updated progress; confirm it enters the continuous history, becomes Last Contact, updates current progress, and schedules the next study according to the selected decision.
7. Record a Missed/Attempted Study; confirm it enters history but does not replace Last Contact or count as a successful interaction.
8. For both conducted and missed entries, choose a specific next study and confirm the one-time date/time takes precedence.
9. Edit both study history types and confirm corrections persist after reload.
10. Delete a study history entry, first canceling and then confirming; verify only that entry is removed and derived dates update appropriately.
11. Pause an active study; confirm it disappears from Home but remains visible in Bible Studies and Paused Contacts. Resume it and confirm its schedule returns.
12. End a Bible Study, choose an ordinary follow-up interval or specific date/time, and confirm it leaves Bible Studies while keeping all earlier study and follow-up history.
13. Confirm the returned Follow-Up appears in the appropriate Home group and can later be established as a Bible Study again without duplication.
14. Reload or completely reopen the app and confirm lifecycle state, study details, schedules, progress, pause state, and history remain unchanged.
15. Confirm Bible Study lists, forms, detail panels, history, and controls have no sideways scrolling on phone and tablet layouts.
16. After loading the update online, launch the installed app offline and confirm the complete Bible-study workflow remains available.

Status: verified. The iOS native date/time control overflow correction was also verified on an actual iPhone.

## Increment 9 verification

1. Select the current month and confirm the report is visible at any time without running a separate calculation.
2. Add or edit an ordinary Successful Contact in the selected month; confirm Follow-ups made increases by one.
3. Add an Attempted Contact in the selected month; confirm neither total changes.
4. Add several Conducted Study entries for one fictional person; confirm Follow-ups made increases for every session while Bible studies conducted increases only once.
5. Add one or more Conducted Study entries for a second person; confirm Bible studies conducted increases by one additional person.
6. Add a Missed/Attempted Study; confirm neither total changes.
7. Change a successful entry’s date into or out of the selected month; confirm the report updates from history.
8. Delete a successful or conducted-study entry; confirm the applicable totals decrease automatically.
9. Select a previous month and confirm its totals are independently calculated from retained history.
10. Reproduce the synthetic regression month: Fred with four conducted studies, Wilma with three conducted studies, and George with two ordinary successful follow-ups. Confirm Follow-ups made is 9 and Bible studies conducted is 2.
11. Reload or completely reopen the app and confirm the same month totals are produced without stored manual counters.
12. Confirm the month control and report cards have no sideways scrolling on phone and tablet layouts.
13. After loading the update online, launch the installed app offline and confirm monthly reporting remains available.

Status: verified.

## Increment 10 verification

1. Create several fictional contacts with multiple successful, attempted, conducted-study, and missed-study history entries.
2. Include at least one paused contact, one active Bible Study, normal intervals, specific follow-up arrangements, and specific study arrangements.
3. Open Data and export a backup. Confirm the suggested filename follows `FollowUpTracker_Backup_YYYY-MM-DD.json`.
4. Store the exported file securely and confirm the interface warns that it may contain private contact information.
5. Deliberately edit and delete several records after exporting so the current app no longer matches the backup.
6. Choose the exported file for restore. Confirm the app displays the backup date, contact count, and history-entry count before replacement.
7. Cancel at the replacement confirmation and confirm the deliberately changed current data remains unchanged.
8. Choose the file again, approve replacement, and confirm the app reloads with the backed-up contacts, histories, schedules, pause state, and Bible-study state restored exactly.
9. Completely close and reopen the app; confirm the restored information remains intact.
10. Recheck Home scheduling and the selected month’s report to confirm restored history drives the same derived results.
11. Try selecting a plain text file, malformed JSON, and an unrelated JSON file; confirm each is rejected without altering current information.
12. If practical, alter a copy of the backup to use an unsupported backup-format version or data version; confirm it is rejected safely.
13. Confirm the Backup/Restore controls, validation messages, and replacement summary have no sideways scrolling on phone, tablet, and desktop layouts.
14. After loading the update online, launch the installed app offline and confirm export and restore remain available.

Status: verified.

## Increment 11 verification

Use fictional information only. Complete every applicable row on actual hardware; browser emulation alone does not verify device support.

| Platform | Required checks |
| --- | --- |
| iPhone | Open in Safari; exercise the main workflow; add to Home Screen; launch in standalone mode; confirm safe-area spacing and native date/time fields; launch again with airplane mode enabled. |
| iPad | Open in Safari in portrait and landscape; confirm readable reflow and no horizontal page scrolling; add to Home Screen; launch in standalone mode; verify saved data after closing and reopening. |
| Android phone or tablet | Open in Chrome; exercise the main workflow; install the PWA; launch in standalone mode; confirm touch controls and native date/time fields; launch again with airplane mode enabled. |
| Desktop | Exercise the normal workflow at wide and narrow browser widths; confirm responsive navigation; export and restore a backup; reload and verify persistence. |

For each platform:

1. Begin online and confirm the current application shell loads after any automatic service-worker update reload.
2. Confirm Home, Contacts, Studies, Report, and Data each open and only the active major screen is rendered.
3. Create or edit a fictional contact, record history, and verify scheduling, pause/resume, Bible-study state, and monthly reporting remain consistent.
4. Close and reopen the browser or installed app and confirm local data persists.
5. Confirm normal vertical page scrolling, reachable controls, readable text, comfortable touch targets, safe-area clearance, and no unintended horizontal page scrolling.
6. Launch offline after at least one successful online load and confirm all local workflows remain available. External phone, email, and maps handoffs are outside the offline guarantee.
7. Return online and confirm the app still opens normally and retains the same local data.

Status: verified.

## Increment 12 verification

Run the automated operational-core regression from the repository root:

```sh
node tests/regression.test.js
```

Then complete this final acceptance pass with fictional information:

1. Reproduce Fred’s lifecycle: initial successful contact, 14-day interval, overdue state, unsuccessful attempt that does not clear the overdue state, later successful contact, Bible Study transition, four conducted studies, pause/resume, and return to Follow-Up.
2. Add Wilma with three conducted study sessions and George with two ordinary successful follow-ups in the same selected month.
3. Confirm the report shows **Follow-ups made: 9** and **Bible studies conducted: 2**; attempts and missed studies must not count.
4. Confirm Home remains ordered Overdue → Due Today → Upcoming, with older overdue contacts first and appointment times visible.
5. Edit and delete individual history entries and confirm Last Contact, scheduling, and reporting recalculate from retained authoritative history.
6. Export a complete backup, deliberately change or delete data, restore the backup, and confirm exact recovery after fully closing and reopening the app.
7. Launch the installed app offline and confirm the operational loop remains available without horizontal page overflow.

Status: automated regression passed; awaiting final user acceptance.

## Known limitations

- Data remains local to each browser/app installation; there is no cloud synchronization or automatic cross-device transfer.
- Notifications, accounts, shared databases, calendar integration, and other explicit non-goals remain intentionally absent.
