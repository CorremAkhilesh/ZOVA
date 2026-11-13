# ADR 0006: Link previews fetched once, by our server, for the sender

**Status:** accepted

## Decision

When someone types a link, their app asks our API (`POST /v1/link-previews`) after a short pause. Our
server fetches the page once, reads its Open Graph and Twitter tags as plain text, downloads and resizes
the picture, and caches the result. The preview the sender keeps goes with the message, as a copy.
Receivers never contact the site, and no app ever loads a third-party image: pictures are served by our
API (`/v1/link-previews/images/:id`, signed-in users only), which keeps the content security policy
strict.

## SSRF protection

The fetcher (`backend/src/link-preview/`) treats every link as hostile:

- `http:` and `https:` only; no credentials in the URL; ports 80, 443 and 1024–65535.
- **Address checks after DNS:** every address a name resolves to is checked. Refused: private,
  loopback, link-local (169.254.0.0/16, including the cloud metadata address), carrier-grade NAT,
  documentation, multicast, reserved and unspecified ranges; IPv6 loopback, unique-local, link-local,
  multicast, NAT64, Teredo, 6to4 and IPv4-mapped forms of all the above; names like `localhost`,
  `*.local` and `*.internal`. IP literals in decimal, hex or octal are normalised first.
- **No DNS rebinding:** the socket connects to the exact address that was checked (a pinned `lookup`),
  on a fresh connection, while the Host header and TLS SNI keep the original name.
- **Redirects:** at most 3, followed by hand, each checked again from the start.
- **Limits:** 5 s in total, 3 s to connect, 1 MB of HTML after decompression, HTML only.
- **Pictures:** 5 MB, decoded with `sharp` (JPEG, PNG, WebP, GIF, AVIF; never SVG), at most 40 MP,
  resized to fit 600×600, saved as WebP with metadata stripped.

## Cache and limits

- Cached by the normalised URL for a day; a failure for an hour (`link_previews`, TTL index).
- 30 lookups a minute per person.
- A message carries a preview only if its text still contains that link; anything else is dropped
  quietly and the message still goes.

## Consequences

- The sender's app learns nothing the server did not already allow, and a malicious page can only ever
  produce plain text and a re-encoded picture.
- Preview pictures are kept as long as a message may point at them. Removing ones no message uses is a
  later clean-up job (see `docs/backlog.md`).
