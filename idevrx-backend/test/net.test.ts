import { describe, it, expect } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { isPublicIp, safeLookup, validateWebhookUrl, signPayload, postJson } from "../src/net.js";

describe("isPublicIp", () => {
  it("blocks private, loopback, link-local and reserved addresses", () => {
    for (const a of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "2001:db8::1", "not-an-ip", ""]) {
      expect(isPublicIp(a), a).toBe(false);
    }
  });
  it("allows public addresses", () => {
    for (const a of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "172.15.255.255", "2001:4860:4860::8888", "::ffff:8.8.8.8"]) expect(isPublicIp(a), a).toBe(true);
  });
});

describe("validateWebhookUrl", () => {
  it("rejects anything that isn't a public https address", () => {
    for (const u of ["http://hooks.example.com/x", "https://localhost/x", "https://10.0.0.5/x", "https://127.0.0.1/x", "https://[::1]/x", "https://169.254.169.254/latest", "https://user:pw@hooks.example.com/x", "https://intranet/x", "https://printer.local/x", "https://app.internal/x", "not a url", "ftp://example.com"]) {
      expect(validateWebhookUrl(u), u).not.toBeNull();
    }
  });
  it("accepts public https addresses", () => {
    for (const u of ["https://hooks.example.com/idevrx", "https://example.org:8443/a?b=c", "https://8.8.8.8/x"]) expect(validateWebhookUrl(u), u).toBeNull();
  });
});

describe("signPayload", () => {
  it("is deterministic and depends on the secret, time and body", () => {
    const a = signPayload("s3cret", "1700000000", '{"a":1}');
    expect(a).toMatch(/^sha256=[a-f0-9]{64}$/);
    expect(signPayload("s3cret", "1700000000", '{"a":1}')).toBe(a);
    expect(signPayload("other", "1700000000", '{"a":1}')).not.toBe(a);
    expect(signPayload("s3cret", "1700000001", '{"a":1}')).not.toBe(a);
    expect(signPayload("s3cret", "1700000000", '{"a":2}')).not.toBe(a);
  });
});

describe("outbound requests", () => {
  const open = (_h: string, o: any, cb: any) => (o.all ? cb(null, [{ address: "127.0.0.1", family: 4 }]) : cb(null, "127.0.0.1", 4));
  let hits = 0;
  let seen: any;
  const server = http.createServer((req, res) => {
    hits++;
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      seen = { method: req.method, headers: req.headers, data, url: req.url };
      if (req.url === "/redirect") { res.writeHead(302, { Location: "/ok" }); res.end(); }
      else if (req.url === "/hang") { /* never answers */ }
      else { res.writeHead(200); res.end("fine"); }
    });
  });
  let base = "";
  const ready = new Promise<void>((r) => server.listen(0, "127.0.0.1", () => { base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; r(); }));

  it("posts the body and headers, and reports the status", async () => {
    await ready;
    const r = await postJson(base + "/ok?x=1", '{"hi":1}', { "Content-Type": "application/json", "X-Idevrx-Event": "ping" }, { lookup: open });
    expect(r.status).toBe(200);
    expect(seen).toMatchObject({ method: "POST", url: "/ok?x=1", data: '{"hi":1}' });
    expect(seen.headers["x-idevrx-event"]).toBe("ping");
  });
  it("does not follow redirects", async () => {
    await ready;
    hits = 0;
    expect((await postJson(base + "/redirect", "{}", {}, { lookup: open })).status).toBe(302);
    expect(hits).toBe(1);
  });
  it("times out", async () => {
    await ready;
    await expect(postJson(base + "/hang", "{}", {}, { lookup: open, timeoutMs: 200 })).rejects.toThrow("Timed out");
  });
  it("refuses loopback and private targets by default", async () => {
    await ready;
    await expect(postJson(base + "/ok", "{}", {})).rejects.toThrow("Blocked address");
    await expect(postJson("http://[::1]:1/x", "{}", {})).rejects.toThrow("Blocked address");
    await expect(postJson("http://169.254.169.254/latest/meta-data", "{}", {})).rejects.toThrow("Blocked address");
    await expect(postJson(`http://localhost:${new URL(base).port}/ok`, "{}", {})).rejects.toThrow("Blocked address");
    const err = await new Promise<Error>((res) => safeLookup("localhost", {}, (e: Error) => res(e)));
    expect(err.message).toBe("Blocked address");
    server.closeAllConnections();
    server.close();
  });
});
