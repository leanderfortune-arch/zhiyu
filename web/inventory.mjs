/** Add discovered metadata without replacing any existing asset or credential. */
export function mergeInventory(snapshot, inventory) {
  const state = snapshot?.state ?? snapshot ?? {};
  const next = { ...state };
  const added = {};
  const identities = {
    servers: (item) => `${item.host}:${item.port || 22}`,
    services: (item) => {
      // Containers sharing a reverse-proxy URL remain separate managed resources.
      if (item.provider === "Docker") return "docker:" + item.name;
      if (!item.url) return item.name;
      try {
        return new URL(item.url).href;
      } catch {
        return item.url;
      }
    },
    aiAssets: (item) => `${item.provider}:${item.name}`,
  };
  for (const [collection, identity] of Object.entries(identities)) {
    const before = state[collection] || [];
    const ids = new Set(before.map((item) => item.id));
    const keys = new Set(before.map(identity));
    next[collection] = [...before];
    added[collection] = 0;
    for (const item of inventory[collection] || []) {
      if (!item.id || !item.name || ids.has(item.id) || keys.has(identity(item))) continue;
      next[collection].push(item);
      ids.add(item.id);
      keys.add(identity(item));
      added[collection]++;
    }
  }
  const valid = new Set([
    ...next.servers.map((item) => `server:${item.id}`),
    ...next.services.map((item) => `service:${item.id}`),
    ...next.aiAssets.map((item) => `ai:${item.id}`),
  ]);
  next.links = [...(state.links || [])];
  const linkKey = (link) =>
    [`${link.from.kind}:${link.from.id}`, `${link.to.kind}:${link.to.id}`].sort().join("|");
  const links = new Set(next.links.map(linkKey));
  added.links = 0;
  for (const link of inventory.links || []) {
    if (
      !valid.has(`${link.from.kind}:${link.from.id}`) ||
      !valid.has(`${link.to.kind}:${link.to.id}`) ||
      links.has(linkKey(link))
    )
      continue;
    next.links.push(link);
    links.add(linkKey(link));
    added.links++;
  }
  return { snapshot: snapshot?.state ? { ...snapshot, state: next } : next, added };
}
