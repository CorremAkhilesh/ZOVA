# Realtime events

Every Socket.IO event is defined **once** here as a Zod schema. Both sides derive their types from it.

## The pattern

1. Write the payload schema in the feature's file, for example `realtime/message.ts`.
2. Register it in [events.ts](events.ts):
   - **Client → server:** add `{ payload, ack }` to `clientToServerEvents`.
   - **Server → client:** add the payload schema to `serverToClientEvents`.
3. Use the derived maps as Socket.IO generics:

   ```ts
   // backend
   new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);
   // frontend
   const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(url);
   ```

## Rules

- **Validate on the server.** Parse every incoming payload with its schema before doing anything else,
  and check authorization in every handler.
- **Always acknowledge client events.** Reply with an `AckResponse`: either `{ ok: true, data }` or
  `{ ok: false, error: ApiError }`.
- **Event names** use `domain:action`, for example `message:send`, `message:new` or `typing:start`.
- **Dates** cross the wire as ISO strings (`isoDateTimeSchema`), and IDs as ObjectId strings.
