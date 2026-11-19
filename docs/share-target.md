# Share to Zuvo

Another app's **Share** menu can send files, photos, videos, links and text into Zuvo, like other
messengers. It is the Web Share Target API: the installed app's manifest declares a `share_target`.

## Flow

1. The manifest (`frontend/vite.config.ts`) asks for a `POST` (multipart) to `/share-target` with
   `files` (any type, several at once) plus `title`, `text` and `url`.
2. The service worker (`frontend/src/sw/share/`) takes that request: it reads the form, names the
   files safely (no folders or control characters, at most 200 characters), keeps at most 30 files
   and caps the text, and stores everything in its own IndexedDB database (`zuvo-share`) on this
   device. Then it answers `303` to `/share?id=…`.
3. `/share` (signed in; a share made while signed out continues after sign-in) shows the files and
   text, the chats to pick (up to 5; only chats I already have and can send to), a caption, and
   **Send**. Files go through the usual outbox: resumable uploads, progress in each chat, the 1 GB
   limit from `GET /v1/config`. Text or a link alone opens one chat with it in the message box.
4. The stored share is deleted as soon as it is sent or cancelled, and anything older than a day is
   deleted with the next share.

## When the service worker is not running

A first share can reach the server before the worker has started. The web container's Nginx
(`deploy/docker/web-nginx.conf`) answers `POST /share-target` with `303 /share?retry=1`, and the page
asks to share again (a static server would say 405). The host Nginx sends `/share-target` to the web
container like every other app path; it needs no change. `deploy/ci/prod-smoke.sh` and
`deploy/ci/live-routes.sh` (run by every deploy) check this route.

## Where it works

- Android Chrome, installed app: Zuvo is in the share list (close and reopen the app once after an
  update; if it is still missing, uninstall and install again).
- Windows / macOS Chrome or Edge, installed app: in the system share menu where the browser supports
  it.
- iPhone / iPad: Apple does not list web apps in the share sheet. Users send from inside Zuvo with
  📎 (Help → Share to Zuvo says so).

## Security

Only same-origin posts are taken (anything else goes to `/share?error=1`). Shares never leave the
device until the person sends them; the server checks every send (membership, blocks, hidden admins)
as usual, verifies file types by their content and keeps its own size limits.
