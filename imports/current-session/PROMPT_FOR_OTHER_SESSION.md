# Prompt for the other Pikmin postcard chat session

I’m turning my Pikmin Bloom postcard chats into a local Codex project.

Please export **all postcard-related material from THIS conversation only** into one ZIP bundle that I can later merge with another session.

Do not re-research everything from scratch unless necessary. The important goal is to preserve the evidence and the research that already exists in this conversation.

Please create the following structure:

- `screenshots/`
  - Copy every original Pikmin Bloom postcard screenshot from this chat.
  - Do not use crops if the original full screenshot is available.
  - Do not include unrelated screenshots.
  - Never overwrite or edit the originals.
  - Give files stable readable names such as:
    `001_YYYY-MM-DD_POI-name.ext`

- `postcards_manifest.json`
- `postcards_manifest.csv`

For every postcard, extract when available:
- sequence/order in this chat
- POI/postcard name
- Pikmin `見つけた日`
- location text exactly as displayed
- sender exactly as displayed (`○○ より`) if visible/confirmed
- relative screenshot path
- rating / keep-delete recommendation we reached in the conversation
- research confidence
- a detailed research summary
- all source URLs that were referenced in the conversation

Important:
- `見つけた日` is NOT necessarily the send date. Keep it as `found_date`.
- If the sender is not visible or was never confirmed, use null/unknown. Do not guess.
- Preserve uncertain identifications explicitly as uncertain.
- Distinguish confirmed facts from inference/speculation.
- Preserve weird/obsolete/wrong Niantic Wayspot names when they are part of the story.
- Do not throw away detailed research just because we can later distill it.

Also create:

### `SESSION_RESEARCH.md`
A detailed per-postcard preservation of the research already done in this chat:
- what the POI really is
- historical / cultural / artistic / local context
- whether the Wayspot name is wrong, informal, or obsolete
- why we decided to keep/delete it
- unresolved questions
- source URLs previously used

### `SESSION_NOTES.md`
Summarize any collection rules or preferences that emerged specifically in this chat and would matter to the future Codex archive.

### `README.md`
Explain that this ZIP is one source-session bundle intended to be merged into a master `pikmin-postcards` repo.

Finally, produce one ZIP file containing all of the above and give me a download link.

Do not omit screenshots just because the sender is unknown: sender inference and postcard curation are separate concerns.
