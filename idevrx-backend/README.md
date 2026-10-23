# Idevrx API (Phase 1 + 2)

Node, TypeScript, Express, MongoDB, S3-compatible storage.

## Run with Docker (easiest)

```bash
docker compose up --build            # API + MongoDB + MinIO storage
docker compose run --rm api node dist/seed.js   # once: learning paths and starter lessons
```

Open http://localhost:4000. Storage console: http://localhost:9001 (minioadmin / minioadmin). Set `JWT_SECRET` in your shell or a `.env` file next to `docker-compose.yml` for anything beyond local use. To make yourself admin: `docker compose exec mongo mongosh idevrx --eval 'db.users.updateOne({username:"you"},{$set:{role:"admin"}})'`.

The API reaches storage on the Docker network (`S3_ENDPOINT`), while the browser uploads to the address in `S3_PUBLIC_ENDPOINT`. Set both when your storage sits behind a different public address.

## Run without Docker

```bash
cp .env.example .env     # fill in MONGODB_URI, JWT_SECRET, S3_*
npm install
npm run dev              # http://localhost:4000/api/health
```

Make yourself an admin (once):

```js
db.users.updateOne({ username: "you" }, { $set: { role: "admin" } })
```

Storage bucket needs a CORS rule allowing `PUT` and `GET` from your frontend origin.

## Tests

```bash
npm install
npm test
```

`test/api.test.ts` runs the whole API against an in-memory MongoDB (the first run downloads a MongoDB binary) with storage faked. It covers: sign-up and login, creator gating, upload validation, the project check, publishing and numbering (001), pending edits and versions (1.0 to 1.2), private drafts, search, likes, saves, comments, replies, notifications, follows, the feed, learning progress and admin-only content. `.github/workflows/ci.yml` runs typecheck and tests on every push.

These tests were written without being run (no network in the environment that produced them). Treat the first `npm test` as part of the setup: a failure there is most likely a small bug or a wrong assumption worth fixing, not a sign the approach is wrong.

## Endpoints

| Method | Path | Who |
|---|---|---|
| POST | /api/auth/register, /api/auth/login | public |
| GET | /api/auth/me | signed in |
| GET | /api/users/:username | public (profile + published projects) |
| PATCH | /api/users/me | signed in |
| POST | /api/users/me/become-creator | signed in |
| PATCH | /api/users/:id/role | admin |
| GET | /api/projects | public (filters: category, difficulty, tag, creator, page) |
| GET | /api/projects/:number-or-id | public if published, else owner/admin |
| GET | /api/projects/mine | creator |
| POST | /api/projects | creator (creates a draft) |
| PATCH | /api/projects/:id | owner |
| POST | /api/projects/:id/publish, /unpublish | owner |
| DELETE | /api/projects/:id | owner (not while published) |
| POST | /api/projects/:id/files/presign | owner |
| POST | /api/files/:id/confirm | uploader |
| GET | /api/files/:id/download | public if project published |
| DELETE | /api/files/:id | uploader |
| GET | /api/search?q=esp32+arm | public (results + facets) |
| PUT, DELETE | /api/projects/:number/like, /save | signed in (idempotent) |
| GET, POST | /api/projects/:number/comments | public read, signed in to post (10/min) |
| DELETE | /api/comments/:id | comment author, project owner or admin |
| PUT, DELETE | /api/users/:username/follow | signed in |
| GET | /api/me/saved, /api/feed | signed in |
| GET | /api/notifications | signed in |
| POST | /api/notifications/read | signed in |

## Behaviour that matches the frontend

- Roles: `user`, `creator`, `admin`. Only creators can create, upload and publish.
- Drafts are private. Publishing runs the project check (title, description, cover, components, steps, at least one file, category), assigns the next project number (`001`...), and records version `1.0`.
- Editing a published project stores changes as pending. The live page changes only when the creator publishes again, which bumps the version (1.0 to 1.1) and adds a revision-history entry.
- Uploads: `presign` (validates type and size) → browser PUTs to storage → `confirm` (checks the real object size). Allowlist only; no .exe, .js or .html. Downloads are always served as attachments.
- YouTube links are validated and reduced to a video ID.

## Frontend (served by this app)

`public/index.html` is the Idevrx UI and `public/bridge.js` connects it to the API: real sign-in, dashboard, autosaving drafts, uploads to storage, publish with versioning, API search, and downloads. Start the server and open http://localhost:4000. Same origin, so no CORS setup is needed for the API (the storage bucket still needs its own CORS rule).

Notes: the session token is kept in localStorage (a future hardening step is httpOnly cookies). Browse pages load the newest 50 projects. Removing a cover image on an existing project clears it only locally until a new cover is uploaded.

## Wiring the frontend (if you build your own)

Replace the localStorage calls with these: sign in/register → `/api/auth/*` and keep the token; dashboard → `/api/projects/mine`; wizard autosave → `POST` once then `PATCH`; Files step → presign, PUT, confirm; Publish → `/publish`; browse and search → `/api/projects` and `/api/search`.

## Community (Phase 3)

- Likes, saves and follows are idempotent and keep their counters in sync with the real rows. Like, save and comment actions only work on published projects.
- Comments are one reply level deep. Replying to a reply attaches to the top comment. Deleting a comment removes its replies.
- Notifications are limited to: a comment on your project, a reply to your comment, a new follower. Likes and saves never notify. "Featured" and "1,000 views" notifications are not built.

## Learning (Phase 4)

Run `npm run seed` once. It creates the 10 learning paths and six starter lessons for Robotics Fundamentals (Sensors, Motors, Microcontrollers, Motor Drivers, Control, Robot Movement). It never overwrites edits, so it is safe to re-run. The other nine paths show "Lessons coming soon" until you add lessons. Path levels other than Robotics Fundamentals are my guesses; change them with the admin API.

- Anyone can read paths and lessons. Signed-in users get progress: lessons marked complete, and projects marked as built.
- A project appears in a path when its number is listed in the path's `projectNumbers`. The project page then shows "Part of: ..." and search also returns matching paths.
- Admin API (set your role to admin first):

```bash
# link projects 001 and 004 to a path
curl -X PATCH localhost:4000/api/learning/robotics-fundamentals -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"projectNumbers":["001","004"]}'
# add a lesson
curl -X POST localhost:4000/api/learning/arduino-fundamentals/lessons -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"title":"Blink an LED","minutes":6,"body":"First paragraph.\n\nSecond paragraph."}'
```

Lesson bodies are plain paragraphs separated by blank lines (no markdown yet). There is no admin screen yet.

## Advanced robotics (Phase 5)

- **BOM:** the components table on a project page has a CSV export (`GET /api/projects/:number/bom.csv`). Cells that start with `=`, `+`, `-` or `@` are neutralised so they can't run as spreadsheet formulas.
- **Code viewer:** "View" next to `.ino .py .cpp .c .h` files (and `.md .txt .csv .json`) shows the file with syntax highlighting. Limit 256 KB.
- **STL preview:** "View" next to a `.stl` file opens a 3D preview you can rotate and zoom, drawn with a small built-in renderer (no libraries). It is flat-shaded, not photorealistic, and large models show every Nth triangle. Limit 15 MB. STEP and F3D files can't be previewed yet.
- **Forks:** signed-in creators get a "Fork project" button. A fork copies the documentation into a new draft, credited to the original ("Fork of Project 001 by ana"). Files and the cover are not copied, so the fork needs its own. Published forks are numbered 001-F1, 001-F2 and so on, and the original shows its fork count. Creators can turn forking off with `PATCH /api/projects/:id {"allowForks": false}` (applies immediately; there is no switch in the UI yet).
- **Version comparison:** pick two versions in the Revision history section to see what changed: fields, tags, components and build steps (`GET /api/projects/:number/compare?from=1.0&to=1.2`).

Not built: interactive wiring diagrams, STEP/F3D preview, simulation.

## Admin and moderation

Make an account admin (see Run), sign in, and an Admin link appears. Four tabs:

- **Reports:** anyone signed in can report a project or a comment (spam, unsafe instructions, copyright, harassment, other), once per target. Admins see open reports and can unpublish the project, delete the comment, mark it resolved or dismiss it.
- **Projects:** search every project in any status. Feature or unfeature a published project (the creator is notified the first time) or unpublish it with a note. The note is sent to the creator as a notification, so removals are never silent. Featured projects appear in the home page's Featured section.
- **Users:** search users, change their role, suspend or restore them. Suspended accounts can't sign in and existing sessions stop working. Admins can't be suspended.
- **Learning:** create and edit learning paths (title, level, summary, order, linked project numbers, hidden or published) and lessons, without using the API.

The admin screens use plain browser prompts and confirms for notes and deletions. Categories are still fixed in code (Robotics, Electronics, AI & Computer Vision, Mechanical, Automation), so there is no category editor yet. There is no audit log.

## Accounts: email verification and password reset

- **Verification:** sign-up sends a link (valid 24 hours). Unverified users see a banner with a resend button. With `REQUIRE_VERIFIED_EMAIL=true`, becoming a creator, publishing and commenting need a verified email. Browsing, liking, saving and following don't. Admins are exempt. Turn it on for production.
- **Password reset:** "Forgot your password?" on the sign-in page sends a one-hour, single-use link. The form gives the same answer whether or not the email has an account. Resetting also verifies the email and signs out every older session.
- **Links** go to `APP_URL/#verify-...` and `APP_URL/#reset-...`. They sit after the `#`, so they never reach server logs. Only a hash of each token is stored.
- **Email delivery:** set `SMTP_URL` (any SMTP service). Without it, emails are printed in the server log. In Docker, emails land in Mailpit at http://localhost:8025, and Docker turns verification on so you exercise the real flow. Set `REQUIRE_VERIFIED_EMAIL` to `"false"` in `docker-compose.yml` to skip it locally.
- **Existing accounts** created before this feature count as unverified. To avoid prompting them: `db.users.updateMany({}, {$set: {emailVerified: true}})`.

**Settings page** (sidebar and header): edit display name and bio, change password (other devices are signed out, this one stays in), change email (the new address must click a link before it takes effect, and the old address is told). Asking to change to an address that is already taken looks identical to success, so it can't be used to look up emails.

Not built: account deletion. It needs a decision first, because published projects and comments are other people's reading material: delete everything, or keep projects and show "deleted user". Until then there is no self-service way for a person to remove their data.

## Developer tools (Phase 6)

Full guide for developers: `docs/API.md`.

- **API keys:** Settings, API keys. A key (`idv_...`) is shown once and only its hash is stored. Read-only keys can only `GET`; read and write keys act as their owner, with the owner's permissions and the same verified-email rules. Keys can't manage keys, change passwords or emails, or use admin endpoints, and revoking one works instantly. Up to 10 active keys per account.
- **Webhooks (creators):** Settings, Webhooks. Events: `project.published`, `comment.created`, `user.followed`. Every delivery is signed (HMAC-SHA256 over `timestamp.body`), retried twice with the same delivery id, and the webhook pauses after 10 failures in a row. "Send test" sends a `ping`. Up to 5 per account.
- **Outbound safety:** a webhook address must be a public `https://` URL. It is checked when you add it, again before each delivery, and the connection itself refuses loopback, private, link-local (cloud metadata) and reserved addresses, including names that resolve to them. Redirects aren't followed, and the response body is ignored.

Limits worth knowing: retries live in memory, so a restart can drop a pending retry. Webhook secrets are stored as-is (they have to be, to sign), so protect database access. Deliveries aren't logged beyond the last status.

Not built: project templates, a robotics SDK, and simulation or hardware integrations. Those need real design decisions about which tools to support, so I haven't guessed.

## Not built yet

Image resizing into thumbnail/medium/large (needs a worker). Admin moderation screens. READY_FOR_REVIEW and ARCHIVED statuses exist in the schema but have no endpoints. Automated tests.

None of this code, including the tests, has been run or type-checked yet. Run `npm run typecheck` and `npm test` first and expect to fix a few small errors.
