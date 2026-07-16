# Non-KOReader Data Support Feasibility

## Goal

Provide an overall view of reading activity regardless of the device or reader application used. The initial additional sources considered here are:

- Stock Kobo
- Moon+ Reader Pro

No implementation changes are covered by this document.

## Executive summary

Supporting both sources is feasible, but they expose different levels of historical detail:

- **Stock Kobo:** Strong support is feasible from `KoboReader.sqlite`, particularly for library state, progress, completion, bookmarks, highlights, and some aggregate reading time. Exact session history is the uncertain part.
- **Moon+ Reader Pro:** Strong support is probably feasible from user-created backup files, including reading statistics, but the backup format and schema need to be inspected and tested across app versions.
- **Unified dashboard:** Realistic, provided kostats stops treating the KOReader SQLite schema as its internal data model and introduces source-neutral normalized records.

## Data overlap

| Data | KOReader today | Stock Kobo | Moon+ Reader Pro |
|---|---:|---:|---:|
| Title and author | Yes | Yes | Yes |
| Series and language | Usually | Often | Likely, depending on book metadata |
| Current progress | Yes | Yes (`___PercentRead`) | Yes |
| Reading or finished status | Yes | Yes (`ReadStatus`) | Yes |
| Last opened | Yes | Yes | Likely |
| Total reading time per book | Yes | Available, but firmware and schema behavior need validation | Likely available in backups |
| Exact dated reading sessions | Yes | Possible but fragile or uncertain | Likely possible, pending backup inspection |
| Daily and monthly reading totals | Yes | Only if session or event timestamps can be recovered | Likely if the backup retains statistics history |
| Pages or locations visited | Yes | Current position, but not necessarily complete page history | Likely position or progress rather than comparable pages |
| Highlights and notes | Counts from sidecars | Yes, from `Bookmark` | Yes; officially exportable and backed up |
| Stable book checksum | KOReader MD5 | Not reliably the same identifier | Not reliably the same identifier |
| Automatic USB import | Yes | Yes on Kobo hardware | No; backup upload or Android-side integration is needed |

Moon+ officially supports whole-app backups and per-book bookmark exports. A third-party reader also documents importing reading statistics directly from a Moon+ backup, which is strong evidence that the backup includes usable statistics rather than only preferences.

Sources:

- [Moon+ Reader FAQ](https://moondownload.com/faq.html)
- [JetReader Moon+ backup import documentation](https://jetreader.net/faq)

## Stock Kobo

### Data source

The primary source would be:

```text
.kobo/KoboReader.sqlite
```

Relevant areas include:

- `content`
  - Title, author, and series metadata
  - `ReadStatus`
  - `___PercentRead`
  - Current bookmark or location
  - Last-read timestamps
  - `TimeSpentReading` on at least some firmware and content combinations
- `Bookmark`
  - Highlights, annotations, and bookmarks
  - Creation and modification timestamps
  - Chapter and container positions
- `Event`
  - Completion, open, close, and statistics events
  - Detailed values embedded in `ExtraData`

### Reading-time limitation

Kobo's aggregate and per-book statistics are partly represented in `Event.ExtraData`. This is an embedded-NUL binary/text structure rather than a clean session table. Recent reverse-engineering reports that the per-book statistics screen reads this data instead of simply using `content.TimeSpentReading`.

Sources:

- [Kobo Event and checksum reverse-engineering](https://www.mobileread.com/forums/showthread.php?t=374074)
- [Older Event table investigation](https://www.mobileread.com/forums/showthread.php?t=226422)

Stock Kobo support should therefore be split into two levels.

### Reliable initial support

- Books and metadata
- Reading, unread, and finished state
- Percent complete
- Last-opened time
- Highlights and notes
- Aggregate time when `TimeSpentReading` is populated and validated
- No claim of exact daily or session history

### Experimental detailed analytics

- Decode supported `Event.ExtraData` formats
- Recover reading seconds and possibly open and close events
- Test several firmware versions
- Test purchased KEPUB, sideloaded EPUB, and other relevant content types
- Preserve unknown event blobs so later parser improvements can process old snapshots

### Import workflow

Automatic ingestion is straightforward because kostats already discovers mounted Kobo devices. Device detection would need to recognize both:

- KOReader's `statistics.sqlite3`
- Stock Kobo's `.kobo/KoboReader.sqlite`

Both could exist on the same physical Kobo and should be represented as separate reader sources attached to one physical device.

## Moon+ Reader Pro

### Recommended integration boundary

The likely input is a backup created through Moon+ Reader's **Options -> Backup** function. This is preferable to reading Android private application storage because:

- Modern Android normally prevents desktop software from accessing another application's internal data.
- ADB or root-based extraction is unsuitable as the normal workflow.
- Moon+ already provides a supported, user-controlled backup mechanism.
- The backup can be uploaded to kostats or copied from shared or cloud storage.

### Required feasibility spike

Real backup samples from the currently installed Moon+ version are needed before committing to a parser design:

1. Create a backup containing a few known books and known reading sessions.
2. Identify whether it is ZIP, SQLite, serialized Java data, or another container.
3. Change one item at a time—reading time, progress, bookmark, and highlight—and diff successive backups.
4. Map book identity, history, timestamps, duration units, progress, and annotations.
5. Repeat with an older or newer Moon+ version if backward compatibility matters.

The expected result is high confidence for progress, status, total time, and annotations, but only moderate confidence for exact session reconstruction until a real backup is inspected.

### Import workflow

A manual backup upload is the sensible initial interface. Possible later improvements include:

- Watching a local Dropbox, WebDAV, or sync directory
- Importing automatically from an Android-accessible shared directory
- A small Android companion or purpose-built export flow

## Required architecture

At present, `backend/app/sqlite_stats.py` directly reads KOReader's `book` and `page_stat_data` or `page_stat` tables and constructs the dashboard in the same processing path. That tight coupling is the largest implementation issue.

The desired structure is:

```text
KOReader SQLite and sidecars --\
Stock Kobo SQLite ------------+--> source adapters --> normalized records --> dashboard
Moon+ backup -----------------/
```

### Suggested normalized model

```text
Source
  source type, physical device, application, source-specific version

Work
  canonical identity, title, authors, series, language

SourceBook
  source-native ID, path or content ID, checksum or ISBN, metadata

ReadingEvent
  start time, end time or duration, work, source, confidence, provenance

BookState
  progress, status, last opened, position, total time

Annotation
  type, text or note, location, timestamp, source
```

This would require:

- Extracting dashboard calculations from the KOReader-specific SQL reader
- Adding `KoreaderAdapter`, `StockKoboAdapter`, and `MoonReaderAdapter`
- Persisting normalized records instead of assuming every snapshot is a KOReader database
- Recording provenance and confidence, particularly for inferred sessions
- Separating reader-source identity from physical-device identity
- Generalizing names such as `koreader_version`, `sidecar_path`, and fixed `statistics.sqlite3` snapshot filenames
- Extending upload and auto-import routing by source type
- Adding source badges, filters, and import-health warnings in the frontend

The existing frontend `BookStats`, `ReadingSession`, and device-aware activity types are already close to a source-neutral presentation model. Most charts could remain intact after backend normalization.

## Cross-source book matching

This is the most important accuracy problem after extracting the data.

The current merge logic uses MD5, then normalized title and author, with series and language safeguards. That is a useful base, but different sources may contain:

- Different files or formats of the same work
- EPUB versus KEPUB
- Changed filenames
- Different metadata spellings
- Purchased Kobo content without an original file hash
- Distinct books with the same title

Recommended matching order:

1. Explicit user-approved link
2. ISBN or another strong publication identifier
3. Compatible file or content hash when available
4. Normalized title, author, series, and language
5. Title-only suggestions, never automatic merges

Source books should remain separate underneath a canonical work. This allows activity to aggregate across applications without destroying source-specific state or double-counting uncertain matches.

## Double-counting risks

The system must distinguish between:

- The same activity independently recorded by two applications
- A book read partly in each application
- Kobo and KOReader progress synchronization that copies state but not reading activity
- Imported cumulative totals without event-level history

For exact events, probable duplicates could be detected by matching the work and overlapping timestamps. For cumulative totals, there is no safe automatic subtraction. Totals should carry a scope or provenance classification such as:

- `event-derived`
- `source-cumulative`
- `book-cumulative`
- `unknown-historical-period`

The dashboard can combine trustworthy event-level sessions while presenting non-temporal cumulative totals separately until their coverage is understood.

## Suggested implementation sequence

1. Refactor the KOReader reader into the normalized model without changing visible results.
2. Add stock Kobo library, progress, status, and annotation import.
3. Add stock Kobo aggregate time, clearly identifying whether it is event-derived.
4. Investigate Moon+ backups using controlled samples.
5. Add Moon+ manual backup upload.
6. Add cross-source work matching and a UI for resolving ambiguous matches.
7. Combine streaks, calendars, totals, and sessions only where the underlying source data supports them.

## Feasibility conclusion

Stock Kobo support is a relatively low-risk addition for overall library state, progress, completion, and annotations. Detailed historical reading-time support is feasible but depends on firmware-sensitive `Event` decoding and should initially be considered experimental.

Moon+ Reader Pro support is also likely feasible, and its backup mechanism is the right integration boundary. The effort cannot be estimated tightly until a real backup has been inspected.

The architectural refactor is more significant than either individual parser and should be treated as a medium-to-large backend project. Once a normalized event and state model exists, adding other applications, CSV imports, or manual reading records becomes substantially easier.

The most practical first milestone would provide a unified view of books, progress, completion, last-read time, annotations, and trustworthy reading-time data without implying that every source provides KOReader-quality session history.
