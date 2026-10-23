import { EnvHttpProxyAgent } from "undici";

/** Proxy only AI model, account authorization and usage requests. */
export function createAiFetch({
  proxy = process.env.ZHIYU_AI_PROXY,
  noProxy = process.env.ZHIYU_AI_NO_PROXY || "localhost,127.0.0.1,[::1]",
} = {}) {
  if (!proxy) return Object.assign((...args) => fetch(...args), { close: async () => {} });
  const url = new URL(proxy);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("AI proxy must be an HTTP(S) proxy");
  const dispatcher = new EnvHttpProxyAgent({ httpProxy: url.href, httpsProxy: url.href, noProxy });
  return Object.assign((input, init = {}) => fetch(input, { ...init, dispatcher }), {
    close: () => dispatcher.close(),
  });
}
