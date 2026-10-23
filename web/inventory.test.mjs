import test from "node:test";
import assert from "node:assert/strict";
import { mergeInventory } from "./inventory.mjs";

test("inventory merge preserves edits and credentials and is idempotent", () => {
  const existing = {
    version: 7,
    state: {
      servers: [{ id: "owned", name: "Custom name", host: "host", port: 22, notes: "keep" }],
      services: [],
      aiAssets: [],
      secrets: [{ id: "existing-secret", hint: "keep" }],
    },
  };
  const inventory = {
    servers: [{ id: "new-id", name: "Auto name", host: "host", port: 22 }],
    services: [{ id: "service-one", name: "Container", url: "" }],
    aiAssets: [],
    links: [{ from: { kind: "service", id: "service-one" }, to: { kind: "server", id: "new-id" } }],
  };
  const first = mergeInventory(existing, inventory);
  assert.equal(first.snapshot.state.servers[0].name, "Custom name");
  assert.equal(first.snapshot.state.servers[0].notes, "keep");
  assert.deepEqual(first.snapshot.state.secrets, existing.state.secrets);
  assert.equal(first.snapshot.version, 7);
  assert.equal(first.added.services, 1);
  assert.equal(first.added.servers, 0);
  assert.equal(first.added.links, 0);
  const again = mergeInventory(first.snapshot, inventory);
  assert.deepEqual(again.snapshot, first.snapshot);
  assert.deepEqual(again.added, { servers: 0, services: 0, aiAssets: 0, links: 0 });
});

test("normalized URLs deduplicate while containers sharing a URL remain distinct", () => {
  const existing = {
    servers: [],
    services: [{ id: "manual", name: "Custom project", url: "https://example.com/" }],
    aiAssets: [],
  };
  const inventory = {
    services: [
      { id: "project", name: "Project", url: "https://example.com" },
      { id: "web", name: "web container", provider: "Docker", url: "http://server:3000" },
      { id: "proxy", name: "proxy container", provider: "Docker", url: "http://server:3000" },
    ],
  };
  const first = mergeInventory(existing, inventory);
  assert.equal(first.added.services, 2);
  assert.equal(first.snapshot.services.length, 3);
  assert.equal(mergeInventory(first.snapshot, inventory).added.services, 0);
});
