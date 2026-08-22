# Pikmin Postcard Archive — Init Note

## 1. Project purpose

This is a personal Pikmin Bloom postcard archive and friend-location intelligence project.

The project has two equally important goals:

1. **Postcard collection / curation**
   - Archive postcard screenshots.
   - Research what each POI actually is.
   - Preserve the historical, cultural, local, artistic, and Niantic/Wayspot story behind it.
   - Decide whether a postcard is worth keeping, not only from visual appearance.

2. **Friend activity / likely-base inference**
   - Track which friend sent which postcard, with location and time information visible in the game.
   - Infer a friend's frequently visited area or likely base only after enough repeated evidence.
   - Use that inference to avoid sending them postcards they can easily obtain every day.
   - Separate likely home/base areas from trips, one-off clusters, and travel periods.

The user often reviews postcards on a phone while away from the Mac. The intended workflow is:
**phone screenshot → ChatGPT/Codex Remote → archive/research/update local repo → browser UI reflects the change.**

---

## 2. Source-of-truth principles

### Preserve originals first
Every postcard screenshot is evidence. Never overwrite or destructively edit the original screenshot.

Store originals under a stable relative path, for example:

`images/postcards/YYYY/MM/<id>.<ext>`

Derived crops or compressed thumbnails may be generated separately.

### Do not confuse game dates with send dates
Pikmin Bloom displays `見つけた日`. This is the postcard/POI's game-visible found date and is **not guaranteed to be the time the friend sent the postcard**.

Recommended fields:
- `found_date`: game-visible `見つけた日`
- `received_at`: only if independently known
- `archived_at`: when the screenshot was ingested into this project

Never label `found_date` as `sent_date` without evidence.

### Preserve raw and normalized values
For location:
- keep `location_raw` exactly as shown in Pikmin Bloom;
- add normalized city / region / country fields separately;
- if coordinates are researched, store them separately with a source and confidence.

For sender names:
- preserve the confirmed display name exactly.
- Current corrections from this session:
  - `菎娜`
  - `柳柳`
  - `りゅう`

Do not guess a sender when `○○ より` is not visible or otherwise confirmed.

---

## 3. How to read a postcard screenshot

For every incoming screenshot, extract as much as is actually visible:

- POI / postcard name
- location text shown by Pikmin Bloom
- `見つけた日`
- sender (`○○ より`) if visible
- postcard visual itself
- relevant stamp / postcard frame only if useful
- any visible clue that helps identify the real-world object

Then research the real-world POI.

### Research priority
Prefer:
1. official cultural-heritage / city / museum / venue / institution sources;
2. official project or artist pages;
3. reputable local-history / news / institutional sources;
4. community pages, blogs, old Ingress/Wayspot material only when needed for obscure POIs.

### Important research rule
Always separate:
- **confirmed fact**
- **strong inference**
- **speculation / unresolved**

Do not invent an artist, work title, history, or design intent merely because it seems plausible.

For obscure Wayspots, the fact that the Niantic name is wrong, informal, obsolete, or weird can itself be important research.

---

## 4. What makes a postcard worth keeping

The collection is not just a list of famous tourist spots. A postcard can be valuable because it reveals something hidden about an ordinary place.

Evaluate at least these dimensions:

### A. POI story / intrinsic significance
Does the object itself have:
- a named artist or architect?
- historical status?
- cultural significance?
- a documented project or design concept?

### B. Location-specific connection
A strong postcard often has a story that only makes sense **in that exact place**.

Example:
- `Wallart "LIFESAVER"` is strong because the mural, artist, seaside rescue building, and Ajigaura history are linked.
- A generic Bruce Lee mural is visually strong, but its local connection is weaker if there is no documented relation to the place.

### C. Local history / urban archaeology
Ordinary-looking objects can be excellent postcards if they preserve:
- an old street environment,
- a disappeared institution,
- a renamed college,
- an old Niantic POI,
- a political or industrial landscape,
- infrastructure that reveals how the city changed.

Example:
- 北投教會 looks like an ordinary neighborhood church but is a 1912 historic church with much deeper local history.
- A painted Chunghwa Telecom junction box can represent a recognizable 2000s Taiwanese streetscape and early Ingress culture, even though the object itself is not fine art.

### D. Visual quality
Is the postcard image itself attractive, clear, distinctive, or fun?

Visual quality matters, but **a beautiful photo cannot fully compensate for a meaningless POI**, and an ugly photo can still be worth keeping if the underlying story is exceptional.

### E. Uniqueness / replaceability
Ask:
- Is this specific POI irreplaceable?
- Is it merely one example of a common category?
- Do we already have another postcard that tells the same story better?

Example:
- `長安公園全區導覽圖` is replaceable because `北投與磺港溪環境紋理變遷 說明牌` already captures the same place/story much better.

### F. Legacy / time-capsule value
Commercial venues, airport displays, old Wayspots, old street furniture, and temporary art can become more interesting if the real-world object later disappears.

### G. Series potential
If the real-world POIs are intentionally a set, the set itself is collectible.

Example:
- `擎天觸地` is one of 法鼓八式動禪; collecting all eight would be a meaningful series.

### H. Personal relevance
A place can receive extra weight if it is personally meaningful to the user.

Personal meaning is a legitimate collection dimension, but store it separately from objective historical/artistic significance so the two are not confused.

---

## 5. Working rating scale

Use stars as a practical curation aid, not as scientific truth.

- **5.0 — 必留 / must keep**
  - exceptional historical, cultural, artistic, site-specific, or personal value;
  - very difficult to replace.

- **4.5 — 強烈建議留**
  - unusually strong story, local connection, series value, or time-capsule value.

- **4.0 — 留**
  - clearly worthwhile, but not sacred; may become replaceable by a better version.

- **3.5 — 候補 / representative keep**
  - interesting context, but generic or replaceable;
  - keep until a better postcard covers the same story.

- **3.0 and below — deletion candidate**
  - weak POI, generic sign/map, little local story, poor image, or redundant with a better postcard.

Important: do not automatically keep every POI just because research found some history around the place.
The object and the place must be evaluated separately.

---

## 6. Friend location / likely-base inference

The user wants to avoid sending friends postcards from places they likely see every day.

Maintain observations per friend, but be conservative.

### Never infer a base from one postcard
One location = one observation, not a home base.

### Look for repeated independent evidence
Stronger evidence comes from:
- multiple different days;
- repeated observations across weeks/months;
- a tight geographic cluster recurring after travel;
- multiple nearby districts/cities consistent with normal daily mobility.

### Separate base vs travel
A friend may generate:
- `likely_base`
- `frequent_areas`
- `trip_clusters`
- `recent_travel`

For example, several postcards in one city on one day may be a trip.
Several postcards in the same metro area across many unrelated dates may indicate a base.

### Recommended confidence representation
Store both:
- a human-readable level: `low / medium / medium-high / high`
- optionally a numeric score later

The inference engine must preserve the observations that led to the conclusion.

### Avoid-send recommendations
Eventually the UI should answer questions like:
- “What areas should I avoid sending to 柳柳?”
- “Which postcards in my inventory are novel for 菎娜?”
- “Is this friend probably local to this POI?”

Avoid-send areas should be derived from repeated observations, not hardcoded guesses.

---

## 7. Suggested data model

A postcard record should eventually support fields like:

```json
{
  "id": "stable-id",
  "sender": "柳柳",
  "poi_name": "Coit",
  "found_date": "2026-05-01",
  "received_at": null,
  "archived_at": "2026-08-23T...",
  "location_raw": "Kajang",
  "city": "Kajang",
  "region": "Selangor",
  "country": "Malaysia",
  "lat": null,
  "lon": null,
  "screenshot": "images/postcards/...",
  "rating": 3.5,
  "recommendation": "可留可汰",
  "research_status": "distilled",
  "research_confidence": "medium",
  "research_summary": "...",
  "source_urls": []
}
```

A friend profile should be derived from postcard observations, not manually duplicated whenever possible.

---

## 8. Research storage: raw first, distill later

Research is valuable data. Do **not** discard the longer research notes after producing a short UI summary.

Recommended layers:

- `research/raw/` — detailed notes, source URLs, unresolved hypotheses
- `research/distilled/` — concise fact-checked summaries used by the website
- `data/postcards.json` — structured postcard metadata
- `data/friends.json` or generated friend profiles
- `images/postcards/` — immutable originals

Raw research should retain:
- exact source URLs;
- statements that were confirmed;
- uncertainty notes;
- alternative identifications considered;
- why the rating/recommendation was given.

Later distillation should be reproducible from this material.

---

## 9. UI goals

The local browser UI should eventually support:

### Postcard table
- sender
- found date
- POI name
- raw / normalized location
- rating
- keep/delete status
- research confidence
- clickable postcard name or thumbnail

Clicking the postcard should open the original screenshot in a modal/popup.

### Friend page / summary
For each friend:
- observation count
- timeline
- map or geographic clusters
- likely base
- confidence
- frequent areas
- travel clusters
- “avoid sending” areas
- recent activity

### Search/filter
Filter by:
- sender
- country / city / district
- rating
- keep/delete
- date
- series
- unresolved research

The current HTML tracker in this bundle is only a prototype and contains only a subset of records.

---

## 10. Examples that define the collection philosophy

### 北投教會 — 5.0
Looks ordinary in daily life, but research reveals a 1912 historic church and much older local church history.
**Lesson:** hidden local significance can outweigh visual plainness.

### Wallart "LIFESAVER" — 5.0
Named artist, documented mural project, site-specific content, local history.
**Lesson:** strongest case of artwork + place + documentation.

### 長安公園全區導覽圖 — ~2.5
The park and river history are interesting, but another postcard explains the same story much better.
**Lesson:** a good place does not make every sign in that place collectible.

### 大業路旁山水彩繪 / 北投市場變電箱 — representative keep
Ordinary telecom infrastructure, but useful as a representative of Taiwanese streetscape and old Wayspot culture.
**Lesson:** keep one strong representative of a category; do not hoard every example.

### CORNER MAX
Modern venue, but the same 1F address previously housed DOZO, and the building belongs to the old CTS media complex.
**Lesson:** commercial-space continuity and personal memory can add value beyond the present tenant.

---

## 11. Current-session bootstrap data

This bundle contains:
- 20 postcard screenshots from the current ChatGPT postcard session;
- `postcards_manifest.json`;
- `postcards_manifest.csv`;
- detailed `CURRENT_SESSION_RESEARCH.md`;
- the current prototype HTML tracker;
- a prompt to export the other postcard-related ChatGPT session in the same format.

This is **not** the complete lifetime postcard archive. Another postcard-related chat session needs to be exported and merged later.

When merging bundles:
- deduplicate by screenshot hash first;
- then compare POI + found_date + sender;
- never delete a screenshot simply because two research notes refer to the same POI;
- preserve provenance (`source_session`) if practical.

---

## 12. Immediate Codex milestones

Recommended order:

1. Initialize git repo.
2. Ingest both ChatGPT-session export bundles.
3. Create an immutable screenshot archive and deduplicate by SHA-256.
4. Normalize the manifest schema.
5. Preserve raw research notes.
6. Build the first static local web UI.
7. Add postcard modal image viewing.
8. Add sender pages and timelines.
9. Add conservative geographic clustering / base inference.
10. Add “avoid sending” recommendations.
11. Only after the raw archive is safe, distill research into shorter canonical records.

Do not over-engineer the first version. The preservation of screenshots, sender/date/location data, and research provenance is more important than UI polish.
