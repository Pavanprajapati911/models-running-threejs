export class Network {
  constructor(ip = "ws://localhost:3000") {
    this.ws = new WebSocket(ip);
    this.onDamage = null;
    this.id = null;
    this.onUpdate = null;
    this.onLeave = null;

    this.ws.onmessage = (msg) => {
      let data;
      try {
        data = JSON.parse(msg.data);
      } catch {
        return;
      }

      if (data.type === "connected") {
        this.id = data.id;
        console.log("Connected with id:", this.id);
        if (this.onUpdate) this.onUpdate(data.characters || []);
      }
      if (data.type === "damage") {
        if (this.onDamage) this.onDamage(data);
      }
      if (data.type === "update") {
        if (this.onUpdate) this.onUpdate(data.characters || []);
      }

      if (data.type === "leave") {
        if (this.onLeave) this.onLeave(data.id);
      }
    };
  }

  sendAttack() {
    console.log("Sending attack message to server");
    this.send({ type: "attack" });
  }

  // ---- JOIN ----
  join(model, position, rotation) {
    this.send({
      type: "join",
      model,
      position,
      rotation,
    });
  }

  // ---- TRANSFORM SYNC (20Hz) ----
  sendState(position, rotation, anim) {
    this.send({
      type: "state",
      position,
      rotation,
      anim,
    });
  }

  // ---- LOW LEVEL ----
  send(msg) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
