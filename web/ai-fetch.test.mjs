import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { connect } from "node:net";
import { once } from "node:events";
import { createAiFetch } from "./ai-fetch.mjs";

test("AI requests and streaming go through the proxy; loopback embeddings bypass it", async (t) => {
  const target = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write('data: {"text":"proxied model"}\n\n');
    res.end("data: [DONE]\n\n");
  });
  target.listen(0, "127.0.0.1");
  await once(target, "listening");
  const connections = [];
  const sockets = new Set();
  const proxy = createServer();
  proxy.on("connect", (req, client, head) => {
    connections.push(req.url);
    const upstream = connect(target.address().port, "127.0.0.1", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => {
        client.destroy();
        upstream.destroy();
      });
    }
  });
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");
  const aiFetch = createAiFetch({
    proxy: `http://127.0.0.1:${proxy.address().port}`,
    noProxy: "127.0.0.1,localhost",
  });
  t.after(async () => {
    await aiFetch.close();
    for (const socket of sockets) socket.destroy();
    target.closeAllConnections();
    proxy.closeAllConnections();
    target.close();
    proxy.close();
  });
  const response = await aiFetch("http://model.invalid/v1/chat/completions", {
    signal: AbortSignal.timeout(5000),
  });
  assert.match(await response.text(), /proxied model/);
  assert.deepEqual(connections, ["model.invalid:80"]);
  await (await aiFetch(`http://127.0.0.1:${target.address().port}/v1/embeddings`)).text();
  assert.equal(connections.length, 1);
});
