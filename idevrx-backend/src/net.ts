// Outbound safety and signing for webhooks. Only Node built-ins, so it can be tested on its own.
import { createHmac } from "node:crypto";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";

// Addresses a webhook must never reach: loopback, private networks, link-local (cloud metadata), and reserved ranges.
const blocked = new BlockList();
([
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as [string, number][]).forEach(([a, p]) => blocked.addSubnet(a, p, "ipv4"));
([
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["100::", 64], ["2001::", 32], ["2001:db8::", 32], ["2002::", 16],
  ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as [string, number][]).forEach(([a, p]) => blocked.addSubnet(a, p, "ipv6"));

export function isPublicIp(address: string): boolean {
  let ip = address;
  const dotted = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i); // IPv4 written inside IPv6
  const hex = address.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (dotted) ip = dotted[1];
  else if (hex) {
    const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16);
    ip = [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
  }
  const family = isIP(ip);
  if (!family) return false;
  return !blocked.check(ip, family === 4 ? "ipv4" : "ipv6");
}

// Checked when the request is made, so a hostname that later resolves to a private address (DNS rebinding) is refused too.
export function safeLookup(hostname: string, options: any, cb: any) {
  if (typeof options === "function") { cb = options; options = {}; }
  if (typeof options === "number") options = { family: options };
  dns.lookup(hostname, { ...options, all: true }, (err, addrs: any) => {
    if (err) return cb(err);
    const list = addrs as { address: string; family: number }[];
    if (!list.length || list.some((a) => !isPublicIp(a.address))) return cb(new Error("Blocked address"));
    options.all ? cb(null, list) : cb(null, list[0].address, list[0].family);
  });
}

// Returns an error message, or null if the address is acceptable. Hostnames are checked again at delivery time.
export function validateWebhookUrl(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return "Enter a full https:// address"; }
  if (u.protocol !== "https:") return "Only https:// addresses are allowed";
  if (u.username || u.password) return "Don’t put credentials in the address";
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(host)) return isPublicIp(host) ? null : "That address points to a private network";
  if (host === "localhost" || !host.includes(".") || /\.(localhost|local|internal|lan|home|corp)$/.test(host)) return "That address isn’t a public host";
  return null;
}

// The receiver recomputes this over "<timestamp>.<raw body>" with the shared secret.
export const signPayload = (secret: string, timestamp: string, body: string) =>
  "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

// One POST. Redirects are not followed, the response body is discarded, and private addresses are refused
// (by the lookup for names, and by an explicit check for literal IPs).
export function postJson(url: string, body: string, headers: Record<string, string>, opts: { timeoutMs?: number; lookup?: any } = {}): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const host = u.hostname.replace(/^\[|\]$/g, "");
    // Node never calls the lookup for a literal IP, so a private IP address has to be refused here.
    if (!opts.lookup && isIP(host) && !isPublicIp(host)) return reject(new Error("Blocked address"));
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(
      {
        hostname: host,
        port: u.port || undefined,
        path: u.pathname + u.search,
        method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
        timeout: opts.timeoutMs ?? 5000,
        lookup: opts.lookup ?? safeLookup,
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode ?? 0 }));
        res.on("error", reject);
      }
    );
    req.on("timeout", () => req.destroy(new Error("Timed out")));
    req.on("error", reject);
    req.end(body);
  });
}
