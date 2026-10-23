import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function createAuth(directory, { secure = true, now = Date.now } = {}) {
  const file = join(directory, "web-owner.json");
  let owner;
  try {
    owner = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const password = process.env.ZHIYU_INITIAL_PASSWORD || randomBytes(24).toString("base64url");
    if (password.length < 16)
      throw new Error("Initial Web password must contain at least 16 characters");
    const salt = randomBytes(16).toString("hex");
    owner = { salt, hash: scryptSync(password, salt, 64).toString("hex") };
    await writeFile(file, JSON.stringify(owner), { mode: 0o600, flag: "wx" });
    // Never log a credential. One-time credential can only be retrieved over SSH.
    await writeFile(join(directory, "initial-password.txt"), password + "\n", {
      mode: 0o600,
      flag: "wx",
    });
  }
  const sessions = new Map();
  const failures = new Map();
  const cookie = (value, maxAge) =>
    `zhiyu_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
  return {
    sessions,
    authenticate(req) {
      const token = /(?:^|;\s*)zhiyu_session=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || "")?.[1];
      const session = sessions.get(token);
      if (!session || session.expires < now()) {
        sessions.delete(token);
        return null;
      }
      return { token, ...session };
    },
    login(password, address) {
      const previous = failures.get(address);
      if (previous && previous.until > now() && previous.count >= 5) return { limited: true };
      if (typeof password !== "string" || password.length > 1024) return { ok: false };
      const candidate = scryptSync(password, owner.salt, 64);
      if (!timingSafeEqual(candidate, Buffer.from(owner.hash, "hex"))) {
        const record =
          previous?.until > now() ? previous : { count: 0, until: now() + 15 * 60_000 };
        record.count++;
        failures.set(address, record);
        if (failures.size > 1000)
          for (const [key, value] of failures) if (value.until < now()) failures.delete(key);
        return { ok: false };
      }
      failures.delete(address);
      // A single active owner session keeps the shared vault isolated from old logins.
      sessions.clear();
      const token = randomBytes(32).toString("base64url");
      const csrf = randomBytes(32).toString("base64url");
      sessions.set(token, { csrf, expires: now() + 12 * 60 * 60_000 });
      return { ok: true, cookie: cookie(token, 12 * 60 * 60), csrf };
    },
    logout(token) {
      sessions.delete(token);
      return cookie("", 0);
    },
  };
}
