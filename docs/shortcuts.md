# Keyboard shortcuts

`Mod` is **Ctrl** on Windows and Linux and **⌘** on macOS (the app shows the right one).
The in-app list (Mod+/) comes from `frontend/src/features/commands/shortcuts.ts`; keep both in step.

## General

| Keys  | Action                                                             |
| ----- | ------------------------------------------------------------------ |
| Mod+K | Search and commands (the command palette); press again to close it |
| Mod+/ | Show every keyboard shortcut                                       |
| Mod+N | New chat (only where the browser lets the page have it, see below) |
| Esc   | Close a dialog or menu                                             |

## Chats

| Keys       | Action                                             |
| ---------- | -------------------------------------------------- |
| Esc        | Cancel a reply, an edit or a selection             |
| Esc        | Otherwise, close the open chat (wide screens)      |
| R          | Reply to the focused message                       |
| Space      | Play or pause the focused voice note               |
| ← / →      | Voice note: back or forward 5 seconds (also ↓ / ↑) |
| Home / End | Voice note: start or end                           |

## Composer

| Keys        | Action                                         |
| ----------- | ---------------------------------------------- |
| Enter       | Send                                           |
| Shift+Enter | New line                                       |
| ↑           | Edit your last message (when the box is empty) |
| Mod+B       | Bold (wraps the selection in `*`)              |
| Mod+I       | Italic (wraps the selection in `_`)            |

## Search

| Keys              | Action                                       |
| ----------------- | -------------------------------------------- |
| ↑ / ↓             | Move through results and commands            |
| Enter             | Open the result, or run the command          |
| `>` (typed first) | Command mode: only commands, matched fuzzily |
| Enter / ↓         | Search in a chat: newer match                |
| Shift+Enter / ↑   | Search in a chat: older match                |
| Esc               | Close search                                 |

Commands in the palette: New chat, New group, Open Saved Messages, Go to Starred, Go to Archived,
Mark all as read, Toggle theme, Switch language, Go to Settings, Go to Devices, Lock app (coming
soon) and Keyboard shortcuts. The last five run are listed first when nothing is typed (stored per
device). English keywords ("dark mode", "theme", "devices"…) find commands in every language.

## Why not these

Shortcuts that browsers keep for themselves are not used, because a web page cannot rely on getting
them:

- **Ctrl+N** opens a new browser window. The app's Mod+N works only where the browser passes it to
  the page (the installed PWA window does); in a normal tab the browser may win.
- **Ctrl+T** (new tab), **Ctrl+W** (close tab), **Ctrl+L** (address bar) are never delivered to pages
  in Chrome and Edge.
- **Ctrl+F** is left to the browser's find in page; in-chat search has its own button.
- **Ctrl+Tab** / **Ctrl+Shift+Tab** switch tabs; **Ctrl+Shift+N** / **Ctrl+Shift+P** open private
  windows.

**Ctrl+K** and **Ctrl+/** are safe inside a web page in Chrome, Edge, Firefox and Safari (⌘K and ⌘/
on macOS): the page receives them and can call `preventDefault()`. In Firefox, Ctrl+K focuses the
browser's search bar only when the page does not handle it.
