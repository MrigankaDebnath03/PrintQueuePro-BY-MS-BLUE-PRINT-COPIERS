# PrintQueuePro — Project Plan
**By Blue Print Copiers**

## 1. Overview

PrintQueuePro is a lightweight, in-shop ordering web app for walk-in print/copy customers. Instead of dictating job details to a counter staff member, a customer fills out a short form on a shop device (or their own phone) — name, phone number, files, and per-file size/quantity — and the order lands instantly in an admin portal where staff can view, download, and fulfill it.

This is a **standalone, single-purpose tool** — narrower in scope than a full e-commerce platform, and built as a fully serverless, single-platform app on Cloudflare (Workers + R2). There's no login/signup, no online payment, no shipping/tracking, and no separate database or server to manage.

## 2. Goals

- Replace verbal/handwritten order-taking with a structured digital form
- Support multiple files per order, each with its **own** size and quantity
- Give staff an instant, interactive view of new orders with one-click file downloads
- Automatically clean up old orders/files so storage doesn't grow unbounded
- Keep infrastructure to an absolute minimum — no servers to patch, no database to host, matched to genuinely low, single-shop traffic

## 3. Non-Goals (v1)

- No customer login, accounts, or order history
- No online payment (pricing/payment handled at the counter, as today)
- No delivery/shipping or order tracking page
- No multi-location support

## 4. User Flows

### Customer Flow
1. Customer opens PrintQueuePro on an in-shop tablet/kiosk or their own phone (e.g., via a QR code at the counter)
2. Enters **Name** and **Phone Number**
3. **Uploads files** — multi-file picker accepting `.dwg`, `.pdf`, `.jpg`, `.png`
4. For **each file individually**, sets:
   - **Size**: A4 / A3 / A2 / A1 / A0
   - **Quantity**: numeric (1, 2, 3, …)
5. Optionally enters an **Address**
6. Taps **Upload** — one request creates the order and pushes files straight to R2; customer sees a confirmation screen with an **order/token number** they can reference at the counter

### Admin (Staff) Flow
1. Staff opens the admin portal at a separate, password-protected route (not linked from the customer-facing page)
2. Sees a live-updating list of incoming orders, newest first
3. Opens an order to view: customer name, phone, address, and each file with its assigned size + quantity
4. Downloads files individually, or all at once as a zip, and prints/plots the job
5. Marks the order **Completed** once served
6. A scheduled job periodically purges completed (and stale/abandoned) orders and their files after a retention window

## 5. Data Model

No database — each order is a single JSON object living in R2, right next to its files.

**`orders/{order_id}/order.json`**
```json
{
  "order_id": "b6a1e5b2-2f2b-4b0a-9b3e-6b8f2a1c9d4e",
  "token_number": 42,
  "customer_name": "Anindya Roy",
  "phone_number": "+91 98765 43210",
  "address": null,
  "status": "New",
  "created_at": "2026-09-17T10:15:00Z",
  "completed_at": null,
  "files": [
    {
      "r2_key": "orders/b6a1e5b2-.../files/site-plan.dwg",
      "original_filename": "site-plan.dwg",
      "file_type": "dwg",
      "size": "A1",
      "quantity": 2
    },
    {
      "r2_key": "orders/b6a1e5b2-.../files/id-photo.jpg",
      "original_filename": "id-photo.jpg",
      "file_type": "jpg",
      "size": "A4",
      "quantity": 1
    }
  ]
}
```

`status` is one of `New` / `In Progress` / `Completed`. The uploaded files live alongside it at `orders/{order_id}/files/{original_filename}`.

## 6. Tech Stack

A fully JavaScript, serverless stack — no Java, no Angular, no separate database, no Docker:

- **Frontend**: Plain HTML/CSS/JS — one page for the customer intake form, one for the admin portal. No framework, no build step required.
- **Backend**: A single **Cloudflare Worker** (JavaScript) handling every API route
- **Storage**: **Cloudflare R2** — holds both the uploaded files *and* the order metadata (as JSON), via R2's native Workers binding
- **Hosting**: **Workers with static assets** — Cloudflare's current recommended default for a new full-stack app; one deployment serves the static frontend and the API together
- **Scheduling**: Workers **Cron Triggers** for the cleanup job
- **Admin auth**: A shared password check to start (Workers Secret), with Cloudflare Access as a zero-code upgrade later (Section 12)
- **Deployment**: Wrangler CLI (`wrangler deploy`) — no server to provision, patch, or containerize

## 7. File Upload Design

- The customer form builds a single `FormData` payload on submit — name, phone, address, and every file with its matching size/quantity — and sends it as one `fetch('/api/orders', { method: 'POST', body: formData })`. No presigned URLs, no separate upload step.
- The Worker parses it with `request.formData()`, generates an `order_id` (`crypto.randomUUID()`), streams each file straight into R2, and writes `order.json` alongside them:

```js
async function handleOrderCreate(request, env) {
  const form = await request.formData();
  const orderId = crypto.randomUUID();
  const files = form.getAll("files");
  const sizes = form.getAll("sizes");
  const quantities = form.getAll("quantities");

  const fileRecords = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const key = `orders/${orderId}/files/${file.name}`;
    await env.BUCKET.put(key, file.stream(), {
      httpMetadata: { contentType: file.type },
    });
    fileRecords.push({
      r2_key: key,
      original_filename: file.name,
      size: sizes[i],
      quantity: Number(quantities[i]),
    });
  }

  const order = {
    order_id: orderId,
    token_number: Date.now() % 10000,
    customer_name: form.get("name"),
    phone_number: form.get("phone"),
    address: form.get("address") || null,
    status: "New",
    created_at: new Date().toISOString(),
    completed_at: null,
    files: fileRecords,
  };

  await env.BUCKET.put(`orders/${orderId}/order.json`, JSON.stringify(order));
  return Response.json({ order_id: orderId, token_number: order.token_number });
}
```

- Cloudflare Workers accept request bodies up to **100 MB** (Free/Pro plan) — comfortably enough for a batch of `.dwg`/`.pdf`/`.jpg`/`.png` files from a copy counter
- Validate file count, extension, and per-file size **before** writing anything to R2, and restrict the file `<input accept>` attribute client-side as a first line of defense

## 8. Admin Portal — Interactive View

- `/admin` serves the admin page (static asset); everything under it sits behind the auth check in Section 12
- **List orders**: `env.BUCKET.list({ prefix: "orders/", delimiter: "/" })` returns one "folder" per order; fetch each `order.json` to build the table — no manual index file to keep in sync
- **Update status**: read `order.json`, change `status` (and set `completed_at` when moving to `Completed`), write it back
- **Download a file**: `GET /api/admin/orders/{id}/files/{filename}` → `env.BUCKET.get(key)` → stream `object.body` back to the browser
- Order list auto-refreshes (polling every few seconds is plenty at this volume) so new walk-in orders appear without a manual refresh
- Per-file download button, plus "download all as ZIP" if useful; simple client-side search/filter by name, phone, or status — the order count is small enough to filter in the browser without a query language

## 9. Data Retention & Cleanup

No database rows to clean up — deleting the R2 objects *is* the cleanup, run entirely by a Cron Trigger:

```js
export default {
  async scheduled(controller, env, ctx) {
    const RETENTION_MS = 72 * 60 * 60 * 1000; // 72 hours
    const listing = await env.BUCKET.list({ prefix: "orders/", delimiter: "/" });

    for (const prefix of listing.delimitedPrefixes) {
      const meta = await env.BUCKET.get(`${prefix}order.json`);
      if (!meta) continue;
      const order = JSON.parse(await meta.text());

      const isStaleCompleted =
        order.status === "Completed" &&
        Date.now() - new Date(order.completed_at).getTime() > RETENTION_MS;

      if (isStaleCompleted) {
        const all = await env.BUCKET.list({ prefix });
        await env.BUCKET.delete(all.objects.map((o) => o.key));
      }
    }
  },
};
```

- Wrangler config: `"triggers": { "crons": ["0 3 * * *"] }` — daily at 03:00 UTC (Cron Triggers always run in UTC)
- Consider also purging orders left in **New**/unfulfilled state beyond a longer window (e.g., 7 days) to catch abandoned submissions

## 10. Cloudflare R2 Setup

**Bucket details** (already created):

| Field | Value |
|---|---|
| Bucket name | `printqueuepro` |
| Created | Sep 17, 2026 |
| Location | Asia-Pacific (APAC) |
| S3 API endpoint | `https://eca703aec9b1f863d4680b1ca0071123.r2.cloudflarestorage.com/printqueuepro` |
| Public Development URL | `https://pub-d156a5cb34764f9bad142014c4bd007f.r2.dev` |

- With a Cloudflare Worker as the backend, the app itself **doesn't need the S3 API or its access keys at all** — it talks to `printqueuepro` through R2's native Workers binding (Section 11), which Cloudflare wires in automatically at deploy time, with no credentials to manage
- Keep the Account API token (now **Admin Read & Write**) around only for occasional external tooling (a local script, a one-off migration) — and even then, load it from an environment variable, never hardcode it or paste it into a doc/repo
- **Don't use the Public Development URL to serve customer files** — it's rate-limited and documented as a dev/testing convenience, not a production path. Admin downloads go through the Worker's binding (Section 8) instead, which keeps customers' files from being publicly guessable
- Since R2 has zero egress fees, re-downloading a file to double-check a job before printing costs nothing extra

## 11. Using R2 in This Architecture

**Primary: R2 Workers Binding API** — this is what the Worker uses for everything (no SDK, no credentials):

```jsonc
// wrangler.jsonc
"r2_buckets": [
  { "binding": "BUCKET", "bucket_name": "printqueuepro" }
]
```

Inside the Worker, `env.BUCKET` then exposes `.put(key, value, options)`, `.get(key)`, `.delete(key | key[])`, `.head(key)`, and `.list({ prefix, delimiter })` — exactly the calls used in Sections 7–9.

- Workers API usage guide — https://developers.cloudflare.com/r2/api/workers/workers-api-usage/
- Workers API reference (full method signatures) — https://developers.cloudflare.com/r2/api/workers/workers-api-reference/

**Secondary (optional): the S3-compatible API** — only useful if you ever need to touch the bucket from something that *isn't* this Worker (a local inspection/migration script, CI, etc.), using the credentials from Section 10:

- Get started guide — https://developers.cloudflare.com/r2/get-started/
- S3 API compatibility reference — https://developers.cloudflare.com/r2/api/s3/api/
- Creating/managing API tokens — https://developers.cloudflare.com/r2/api/tokens/
- Presigned URLs — https://developers.cloudflare.com/r2/api/s3/presigned-urls/

## 12. Deployment

- Scaffold with `npm create cloudflare@latest` (or hand-write `wrangler.jsonc`) — install Wrangler via `npm install -g wrangler` or just use `npx wrangler`
- One config file for the whole app:

```jsonc
{
  "name": "printqueuepro",
  "main": "src/index.js",
  "compatibility_date": "2026-09-17",
  "assets": { "directory": "./public", "binding": "ASSETS" },
  "r2_buckets": [{ "binding": "BUCKET", "bucket_name": "printqueuepro" }],
  "triggers": { "crons": ["0 3 * * *"] }
}
```

- `./public/` holds the plain HTML/CSS/JS for both pages; `src/index.js` handles `/api/*` routes and falls back to `env.ASSETS.fetch(request)` for everything else — and exports the `scheduled()` handler from Section 9
- `wrangler deploy` ships the frontend, the API, and the cron job together in one step; `wrangler dev` for local testing
- **Admin protection**: start with a shared password (stored via `wrangler secret put ADMIN_PASSWORD`, checked in the Worker before serving `/admin/*`). If you point a real domain at the Worker later, you can drop in a **Cloudflare Access** self-hosted application in front of `/admin/*` instead — no auth code to write at all, just an email or PIN-gated policy in the dashboard
- A real subdomain (e.g. `print.yourdomain.com`) rather than the default `*.workers.dev` is worth setting up early — it looks more professional for customers and is a prerequisite for the Access upgrade above

## 13. Suggested Build Order

1. Scaffold the Worker project with the R2 binding and `./public` assets directory wired up
2. Build the customer intake page (HTML/CSS/JS) and the `POST /api/orders` handler
3. Build the admin page plus list/status-update/download routes, behind a basic shared-password check
4. Add the Cron Trigger and `scheduled()` cleanup handler
5. Test end-to-end with real `.dwg`/`.pdf`/`.jpg`/`.png` files across all five sizes, including a multi-file order
6. Point a real subdomain at the Worker and deploy
7. *(Optional, later)* Swap the shared password for a Cloudflare Access application in front of `/admin/*`

## 14. Open Questions

- Should the customer-facing confirmation show a **token/queue number** so staff can call customers by number rather than name?
- Is pricing calculated/estimated at submission, or purely handled manually at the counter (as it seems to be today)?
- Do you have a domain ready to point at this, or should it run on the default `*.workers.dev` subdomain for now?
- Shared admin password to start, or set up Cloudflare Access from day one?
- What retention window do you want for completed orders — 24h, 72h, something else?
