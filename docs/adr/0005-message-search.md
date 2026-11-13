# ADR 0005: Message search with a MongoDB text index

**Status:** accepted

## Decision

Message search (`GET /v1/search/messages`) uses a MongoDB **text index** on `messages.text`, with
`default_language: 'english'` and a `language_override` field name that no message has.

- **Words:** whole words only. What is typed is split into words, and each word is sent quoted, so every
  word must be in the message (MongoDB ANDs quoted phrases). Quotes and a leading `-` are taken out.
- **English:** stemmed, so "meeting" finds "meetings". English stop words ("the", "a") are not searchable.
- **Hindi and other scripts:** MongoDB has no Hindi stemmer. Devanagari words are kept as typed (the
  English stemmer leaves them alone), and Devanagari punctuation such as "।" separates words. Tests cover
  this. Diacritic-insensitivity in v3 text indexes only widens the candidates; the quoted-phrase check
  then compares the real text, so results stay exact.
- **Visibility** is part of the query, never filtered afterwards, so a page is never short:
  - only chats I am or was in (`chat_members`), each within the part history gives me
    (`joinSeq`, `leftSeq`, `clearedSeq`), as one `$or` clause per limited chat;
  - not what I deleted for me, not what was deleted for everyone, not what people I blocked sent;
  - system messages are left out.
- **Order and pages:** newest first, cursor on `_id`. MongoDB fetches the matches through the text index
  and sorts them with a limit (a top-k sort), which is fine for an organization's message volume.
- **Kind filters** (photos, videos, docs, links, voice) work with or without words. Without words, each
  `$or` clause uses `{ chatId, type, seq }` or the partial `{ chatId, hasLink, seq }` index.
- **On the device:** the app first searches its own Dexie copies (substring match, any script), then
  merges the server's results, which also cover history the device never loaded.

## Why not Atlas Search

Atlas Search (Lucene) would bring prefix and fuzzy matching, relevance ranking and real language
analyzers (including Hindi via ICU). It is not used for now because:

- it cannot run in `mongodb-memory-server`, so CI and local tests could not test search, or the
  visibility rules inside it, without Atlas — and tests must never use Atlas (CLAUDE.md §3);
- its index is defined and synced outside the app, on the cluster; free and shared tiers limit how many
  search indexes a cluster may have, and dedicated search nodes cost extra;
- `$search` must be the first stage of an aggregation, so the visibility rules move into a `compound`
  filter, a second implementation to keep exactly in line with history.

**When to revisit:** if people need prefix ("meet" finding "meeting" in Hindi as well), typo tolerance or
relevance ranking, or if the message count makes the top-k sort slow. Switching changes only
`search/message-search.service.ts`; the API and the app stay as they are. Not without asking first.

## Consequences

- Production builds the index during deploy (`db:sync-indexes`). On a fresh development database the
  index is built in the background at start; a search in those first seconds gets `503` "Search is
  getting ready" rather than an error.
- Prefix search exists only in the app's local search, for what the device has.
