# Idevrx API guide

Base URL: your site, with `/api` on the end (for example `https://idevrx.com/api`). Everything is JSON.

## API keys

Make a key in **Settings, API keys**. A key looks like `idv_...` and is shown once, so copy it then. Send it as a bearer token:

```bash
curl https://idevrx.com/api/projects?category=Robotics \
  -H "Authorization: Bearer idv_your_key_here"
```

- **Read only** keys can make `GET` requests. **Read and write** keys can also create drafts, upload files, publish, comment and so on, as you.
- A key acts as the account that made it, so it has that account's permissions and the same email-verification rules.
- Keys can't manage keys, change your password or email, or use admin endpoints. Those need a signed-in session.
- Revoke a key in Settings and it stops working immediately. Keys last until revoked.
- Public pages (browsing projects, search, profiles, learning) don't need a key.

## Common endpoints

| What | Request |
|---|---|
| List published projects | `GET /api/projects?category=&difficulty=&tag=&creator=&page=` |
| One project | `GET /api/projects/001` |
| Bill of materials (CSV) | `GET /api/projects/001/bom.csv` |
| Compare versions | `GET /api/projects/001/compare?from=1.0&to=1.2` |
| Search | `GET /api/search?q=esp32+arm` |
| A creator | `GET /api/users/ana` |
| Create a draft | `POST /api/projects` (write key, creator) |
| Update a draft | `PATCH /api/projects/:id` |
| Upload a file | `POST /api/projects/:id/files/presign`, then `PUT` to the returned URL, then `POST /api/files/:fileId/confirm` |
| Publish | `POST /api/projects/:id/publish` |

The README has the full list. Errors come back as `{ "error": "message" }` with a normal HTTP status (400 invalid input, 401 not signed in, 403 not allowed, 404 not found, 409 conflict, 422 not ready to publish, 429 too many requests).

## Webhooks

Creators can have Idevrx call their server when something happens. Add one in **Settings, Webhooks** (up to 5). Addresses must be public `https://` URLs.

| Event | When |
|---|---|
| `project.published` | One of your projects is published or republished |
| `comment.created` | Someone else comments on one of your projects |
| `user.followed` | Someone follows you |

Each delivery is a `POST` with a JSON body:

```json
{
  "id": "6f1c2c0e-3a64-4b0e-9a55-0d2f4d1c9e11",
  "event": "comment.created",
  "createdAt": "2026-10-23T12:00:00.000Z",
  "data": { "project": "001", "commentId": "...", "author": "bob", "body": "Nice build" }
}
```

Headers: `X-Idevrx-Event`, `X-Idevrx-Delivery` (same id as the body, the same on retries), `X-Idevrx-Timestamp` (Unix seconds) and `X-Idevrx-Signature`.

**Always verify the signature** before trusting a delivery. It is an HMAC-SHA256 of `<timestamp>.<raw body>` using your webhook's secret (shown once when you create it):

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export function verify(secret, headers, rawBody, maxAgeSec = 300) {
  const ts = headers["x-idevrx-timestamp"];
  const sig = headers["x-idevrx-signature"] ?? "";
  if (!ts || Math.abs(Date.now() / 1000 - Number(ts)) > maxAgeSec) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  return sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
```

Python:

```python
import hashlib, hmac, time

def verify(secret, headers, raw_body, max_age=300):
    ts = headers.get("x-idevrx-timestamp")
    sig = headers.get("x-idevrx-signature", "")
    if not ts or abs(time.time() - int(ts)) > max_age:
        return False
    expected = "sha256=" + hmac.new(secret.encode(), f"{ts}.{raw_body}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, expected)
```

Use the raw request body exactly as received, not a re-serialised copy.

Delivery rules:

- Reply with any `2xx` within 5 seconds. Redirects are not followed.
- A failed delivery is retried twice (after about 2 and 15 seconds) with the same delivery id. Retries are held in memory, so a server restart can drop them.
- After 10 failures in a row the webhook is paused. Resume it in Settings.
- Use **Send test** in Settings to send a `ping` event.
- Webhooks can't reach private or internal addresses.
