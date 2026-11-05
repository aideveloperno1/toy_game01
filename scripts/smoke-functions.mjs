// Runs against an actual Functions host. Cookie handling is explicit for local HTTP.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const base = process.env.FUNCTIONS_TEST_URL ?? "http://127.0.0.1:7071";
const users = [];
for (let i = 0; i < 3; i++) {
  const response = await fetch(base + "/api/session");
  assert.equal(response.status, 200);
  const { protocol } = await response.json();
  users.push({
    cookie: response.headers.get("set-cookie").split(";")[0],
    tab: randomUUID(),
    protocol,
  });
}
async function post(i, path, body) {
  const response = await fetch(base + "/api/" + path, {
    method: "POST",
    headers: {
      Cookie: users[i].cookie,
      "Content-Type": "application/json",
      "X-Game-Request": "1",
    },
    body: JSON.stringify(body),
  });
  const value = await response.json();
  assert.ok(response.ok, JSON.stringify(value));
  return value;
}
const { code } = await post(0, "rooms", { name: "방장", id: randomUUID() });
const call = (i, op, extra = {}) =>
  post(i, `rooms/${code}/${op}`, {
    protocol: users[i].protocol,
    tab: users[i].tab,
    ...extra,
  });
const command = (i, value) =>
  call(i, "command", { command: { id: randomUUID(), ...value } });
for (let i = 0; i < 3; i++) await call(i, "join", { name: "참가자" + i });
await Promise.all(
  users.map((_, i) => command(i, { type: "ready", ready: true })),
);
const prepared = await command(0, { type: "prepare" });
const roundId = prepared.room.gameState.id;
await Promise.all(users.map((_, i) => command(i, { type: "loaded", roundId })));
const playing = await call(0, "sync");
await new Promise((resolve) =>
  setTimeout(
    resolve,
    Math.max(0, playing.room.gameState.startAt - Date.now() + 100),
  ),
);
await Promise.all(
  users.map((_, i) =>
    command(i, { type: "act", roundId, turn: 0, action: "reveal" }),
  ),
);
const results = await Promise.all(users.map((_, i) => call(i, "sync")));
results.forEach((r) => {
  assert.equal(r.room.phase, "result");
  assert.deepEqual(r.room.results, results[0].room.results);
});
const negotiated = await call(0, "negotiate");
assert.ok(negotiated.url.startsWith("wss://"));
console.log(
  JSON.stringify({
    ok: true,
    clients: 3,
    game: "ladder",
    sameResults: true,
    negotiated: true,
  }),
);
