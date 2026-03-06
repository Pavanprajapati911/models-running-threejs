import express from "express";
import { WebSocketServer } from "ws";

const app = express();
const port = 3000;

// Serve static files
app.use(express.static("../dist"));
const server = app.listen(port, () => {
  console.log(`HTTP server running on http://localhost:${port}`);
});

// WebSocket Server
const wss = new WebSocketServer({ server });

// Keep track of all players
const clients = new Map(); // id => ws
const characters = new Map(); // id => { model, position, rotation, anim }

wss.on("connection", (ws) => {
  const id = Date.now().toString();
  clients.set(id, ws);

  // Send initial connection info
  ws.send(
    JSON.stringify({
      type: "connected",
      id,
      characters: Array.from(characters.values()),
    }),
  );

  ws.on("message", (msg) => {
    const data = JSON.parse(msg);

    if (data.type === "join") {
      // characters.set(id, { id, model: data.model, position: data.position, rotation: data.rotation, anim: "idle" });
      characters.set(id, {
        id,
        model: data.model,
        position: data.position,
        rotation: data.rotation,
        anim: "idle",
        health: 100,
      });
    }

    if (data.type === "state") {
      if (characters.has(id)) {
        const char = characters.get(id);
        char.position = data.position;
        char.rotation = data.rotation;
        char.anim = data.anim || char.anim;
      }
    }

    if (data.type === "attack") {
      console.log("Received attack from: ", id);

      const attacker = characters.get(id);
      if (!attacker) return;

      const attackRange = 2.0;
      const damage = 20;

      for (const [otherId, target] of characters.entries()) {
        if (otherId === id) continue;
        if (target.health <= 0) continue;

        const dx = attacker.position[0] - target.position[0];
        const dz = attacker.position[2] - target.position[2];
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < attackRange) {
          target.health -= damage;
          target.health = Math.max(0, target.health);

          // Broadcast damage event
          const payload = {
            type: "damage",
            targetId: otherId,
            health: target.health,
          };

          for (const client of clients.values()) {
            if (client.readyState === ws.OPEN) {
              client.send(JSON.stringify(payload));
            }
          }
        }
      }
    }

    // Broadcast updated characters to all clients
    const payload = {
      type: "update",
      characters: Array.from(characters.values()),
    };

    for (const [otherId, client] of clients.entries()) {
      if (client.readyState === ws.OPEN) client.send(JSON.stringify(payload));
    }
  });

  ws.on("close", () => {
    clients.delete(id);
    characters.delete(id);
    // Notify others
    const payload = { type: "leave", id };
    for (const client of clients.values()) {
      if (client.readyState === ws.OPEN) client.send(JSON.stringify(payload));
    }
  });
});
