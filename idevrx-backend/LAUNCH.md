# Before you launch

None of this code has been run end to end yet. Do these in order and fix what breaks:

1. `npm install`, then `npm run typecheck`, then `npm test`.
2. `docker compose up --build`, then `docker compose run --rm api node dist/seed.js`.
3. Click through: sign up, verify the email in Mailpit (http://localhost:8025), become a creator, create and publish a project with a cover and a file, comment from a second account, report something, make yourself admin and moderate it.

## Settings to change for production

- `JWT_SECRET`: at least 32 random characters. Never reuse the dev value.
- `REQUIRE_VERIFIED_EMAIL=true`, and a real `SMTP_URL`. Set up SPF and DKIM for your sending domain or reset emails will land in spam.
- `APP_URL`: your real https address. It goes into every email link.
- Serve over https behind a reverse proxy. The app trusts one proxy hop (`trust proxy` is 1). If you have more or fewer, change it, or per-IP rate limits will see the wrong address.
- Storage bucket: private, with CORS allowing only your site's origin for `PUT` and `GET`. Leave `PUBLIC_MEDIA_BASE_URL` empty unless the bucket is meant to be public.
- MongoDB: turn on authentication and automated backups. Create the first admin with the command in the README.
- Security headers (`src/app.ts`): remove `https:` from `connect-src` and keep only your storage origin. Move the inline script out of `public/index.html` into a file so `'unsafe-inline'` can go.

## Decisions that are yours, not the code's

- **Content license.** Forking is on by default, and a fork copies the documentation of someone else's project. Pick a license for published projects (for example Creative Commons Attribution-ShareAlike) and say so on the site and in your terms. Creators can switch forking off through the API but there is no switch in the UI yet.
- **Account deletion.** Not built. Decide what happens to a person's projects and comments when they leave: delete them, or keep projects as "deleted user". You will likely need this, a privacy policy and terms of use before launch, especially for users covered by Nigeria's data protection rules. Ask a lawyer.
- **Moderation.** Decide who the moderators are and what counts as unsafe. Projects involve electronics and mains power, so unsafe instructions are a real risk, not a hypothetical one.

## Known gaps

- Sessions are stored in the browser's local storage. HttpOnly cookies would be safer against script injection.
- Webhook retries are held in memory and a restart can drop them. Webhook secrets are stored as-is.
- No audit log of admin actions, no category editor, no image resizing (thumbnails), no project templates, no SDK, no STEP/F3D preview, no interactive wiring diagrams.
- Search is database text search. It is fine for thousands of projects, not millions.
- Admin screens use plain browser prompts and confirms.
