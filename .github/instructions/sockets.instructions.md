---
description: "Rules for writing and modifying Socket.IO event handlers and setups."
applyTo: "**/*server.ts, **/*socket*.ts"
---
# Socket.IO Event Guidelines

When working on Socket.IO implementations, adhere to the following rules:

1. **Explicit Typing**: 
   - Never use `any` for socket event payloads. Always define an interface or inline type for incoming data.
2. **Detailed Logging**: 
   - Log when a socket connects (`socket.id`), joins a room, or disconnects. Use descriptive emojis for quick visibiity (e.g. 🔌 for disconnects, 📡 for connects).
3. **Room Management**: 
   - Cleanly manage room joins/leaves. If a socket is joining a task/order room, verify the payload contains a valid ID. 
4. **Error Handling**: 
   - Wrap async operations inside socket handlers with `try/catch` block. Emitting an explicit error event back to the client (`socket.emit('error', ...)` ) is preferred over silent server logs.
5. **State Sync**: 
   - Use Redis (like Upstash) caches to retrieve last-known good states so instantly served data handles page-refreshes seamlessly.