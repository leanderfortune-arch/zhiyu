import { sha256 } from "@noble/hashes/sha2.js";

/** 原样保留 Markdown，明确作为源码块编辑，不做有损富文本转换。
 * @param {string} markdown
 * @returns {import("@tiptap/react").JSONContent}
 */
export function rawMarkdownContent(markdown) {
  return {
    type: "doc",
    content: [{ type: "codeBlock", content: [{ type: "text", text: markdown }] }],
  };
}

/** 显式迁移旧服务器记录；旧字段始终保留，重复操作只打开同一篇文档。
 * @param {{ id: string, name: string, docs?: string }} server
 * @param {Pick<import("./documents").DocumentsBridge, "save">} store
 * @returns {Promise<import("./documents").DocumentAsset>}
 */
export async function migrateServerDocument(server, store) {
  if (!server.docs?.trim()) throw new Error("没有可迁移的旧文档");
  const digest = sha256(new TextEncoder().encode(server.id));
  const id =
    "doc-legacy-server-" +
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const now = new Date().toISOString();
  return store.save({
    id,
    title: server.name + " · Markdown",
    content: rawMarkdownContent(server.docs),
    bindings: [{ kind: "server", id: server.id }],
    createdAt: now,
    updatedAt: now,
    createOnly: true,
  });
}
