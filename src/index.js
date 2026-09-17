/**
 * src/index.js — PrintQueuePro Cloudflare Worker
 *
 * Routes:
 *   POST   /api/orders                              → create order
 *   GET    /api/admin/orders                         → list all orders
 *   GET    /api/admin/orders/:id                     → single order
 *   PATCH  /api/admin/orders/:id/status              → update status
 *   DELETE /api/admin/orders/:id                     → permanently delete order + files
 *   GET    /api/admin/orders/:id/files/:filename     → download file
 *   GET    /api/admin/orders/:id/zip                 → download all files as ZIP
 *   *                                                → static assets (env.ASSETS)
 *
 * Admin auth: X-Admin-Password header checked against env.ADMIN_PASSWORD secret.
 *
 * Scheduled: daily cleanup of stale / completed orders (cron 0 3 * * *).
 */

// ── Constants ────────────────────────────────────────────────
const ALLOWED_EXTENSIONS   = ['pdf', 'dwg', 'jpg', 'jpeg', 'png'];
const MAX_FILES_PER_ORDER  = 20;
const MAX_FILE_BYTES        = 50 * 1024 * 1024;        // 50 MB per file
const RETENTION_COMPLETED_MS = 72 * 60 * 60 * 1000;   // 72h after completion
const RETENTION_STALE_MS     =  7 * 24 * 60 * 60 * 1000; // 7 days for abandoned

// ── Helpers ───────────────────────────────────────────────────

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, status);
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password',
  };
}

function getExtension(filename) {
  return (filename.split('.').pop() || '').toLowerCase();
}

// ── Admin auth ────────────────────────────────────────────────

function isAdminAuthorized(request, env) {
  // Allow if no password is configured (dev convenience only)
  if (!env.ADMIN_PASSWORD) return true;
  const provided = request.headers.get('X-Admin-Password') || '';
  return provided === env.ADMIN_PASSWORD;
}

function requireAdmin(request, env) {
  if (!isAdminAuthorized(request, env)) {
    return errorResponse('Unauthorized', 401);
  }
  return null;
}

// ── Order creation ────────────────────────────────────────────

async function handleOrderCreate(request, env) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return errorResponse('Invalid request body — expected multipart/form-data.');
  }

  const name    = (form.get('name')    || '').trim();
  const phone   = (form.get('phone')   || '').trim();
  const address = (form.get('address') || '').trim() || null;

  if (!name)  return errorResponse('Customer name is required.');
  if (!phone) return errorResponse('Phone number is required.');

  const files      = form.getAll('files');
  const sizes      = form.getAll('sizes');
  const quantities = form.getAll('quantities');

  if (!files.length)                    return errorResponse('At least one file is required.');
  if (files.length > MAX_FILES_PER_ORDER) return errorResponse(`Maximum ${MAX_FILES_PER_ORDER} files per order.`);

  // Validate each file
  for (const file of files) {
    const ext = getExtension(file.name);
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return errorResponse(`File "${file.name}" has an unsupported type. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}.`);
    }
    if (file.size > MAX_FILE_BYTES) {
      return errorResponse(`File "${file.name}" exceeds the 50 MB per-file limit.`);
    }
  }

  const orderId = crypto.randomUUID();

  // Generate a compact token: 4-digit number (0001–9999), unique-ish
  const tokenNumber = (Math.floor(Math.random() * 9000) + 1000);

  // Upload each file to R2
  const fileRecords = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const key  = `orders/${orderId}/files/${file.name}`;

    await env.BUCKET.put(key, file.stream(), {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
    });

    fileRecords.push({
      r2_key:            key,
      original_filename: file.name,
      file_type:         getExtension(file.name),
      size:              sizes[i]      || 'A4',
      quantity:          Number(quantities[i]) || 1,
    });
  }

  const order = {
    order_id:       orderId,
    token_number:   tokenNumber,
    customer_name:  name,
    phone_number:   phone,
    address,
    status:         'New',
    created_at:     new Date().toISOString(),
    completed_at:   null,
    files:          fileRecords,
  };

  await env.BUCKET.put(
    `orders/${orderId}/order.json`,
    JSON.stringify(order),
    { httpMetadata: { contentType: 'application/json' } }
  );

  return jsonResponse({ order_id: orderId, token_number: tokenNumber }, 201);
}

// ── List all orders ───────────────────────────────────────────

async function handleListOrders(request, env) {
  const authErr = requireAdmin(request, env);
  if (authErr) return authErr;

  // List all order "folders"
  const listing = await env.BUCKET.list({ prefix: 'orders/', delimiter: '/' });
  const prefixes = listing.delimitedPrefixes || [];

  const orderPromises = prefixes.map(async (prefix) => {
    const obj = await env.BUCKET.get(`${prefix}order.json`);
    if (!obj) return null;
    try {
      return JSON.parse(await obj.text());
    } catch {
      return null;
    }
  });

  const results = await Promise.all(orderPromises);
  const orders  = results.filter(Boolean);

  // Sort newest first
  orders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return jsonResponse({ orders });
}

// ── Get single order ──────────────────────────────────────────

async function handleGetOrder(request, env, orderId) {
  const authErr = requireAdmin(request, env);
  if (authErr) return authErr;

  const obj = await env.BUCKET.get(`orders/${orderId}/order.json`);
  if (!obj) return errorResponse('Order not found.', 404);

  return new Response(obj.body, {
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Update status ─────────────────────────────────────────────

async function handleUpdateStatus(request, env, orderId) {
  const authErr = requireAdmin(request, env);
  if (authErr) return authErr;

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body.');
  }

  const { status } = body;
  const validStatuses = ['New', 'In Progress', 'Completed'];
  if (!validStatuses.includes(status)) {
    return errorResponse(`Invalid status. Must be one of: ${validStatuses.join(', ')}.`);
  }

  const obj = await env.BUCKET.get(`orders/${orderId}/order.json`);
  if (!obj) return errorResponse('Order not found.', 404);

  let order;
  try {
    order = JSON.parse(await obj.text());
  } catch {
    return errorResponse('Corrupt order data.', 500);
  }

  order.status = status;
  if (status === 'Completed' && !order.completed_at) {
    order.completed_at = new Date().toISOString();
  } else if (status !== 'Completed') {
    order.completed_at = null;
  }

  await env.BUCKET.put(
    `orders/${orderId}/order.json`,
    JSON.stringify(order),
    { httpMetadata: { contentType: 'application/json' } }
  );

  return jsonResponse({ ok: true, status: order.status });
}

// ── Delete order permanently ──────────────────────────────────

async function handleDeleteOrder(request, env, orderId) {
  const authErr = requireAdmin(request, env);
  if (authErr) return authErr;

  // Verify order exists
  const obj = await env.BUCKET.get(`orders/${orderId}/order.json`);
  if (!obj) return errorResponse('Order not found.', 404);

  // List all objects under this order's prefix and delete them
  const prefix = `orders/${orderId}/`;
  const all = await env.BUCKET.list({ prefix });
  const keys = (all.objects || []).map(o => o.key);

  if (keys.length) {
    await env.BUCKET.delete(keys);
  }

  return jsonResponse({ ok: true, deleted: orderId });
}

// ── Download single file ──────────────────────────────────────

async function handleDownloadFile(request, env, orderId, filename) {
  const authErr = requireAdmin(request, env);
  if (authErr) return authErr;

  const decodedName = decodeURIComponent(filename);
  const key = `orders/${orderId}/files/${decodedName}`;
  const obj = await env.BUCKET.get(key);

  if (!obj) return errorResponse('File not found.', 404);

  const contentType = obj.httpMetadata?.contentType || 'application/octet-stream';
  return new Response(obj.body, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${decodedName}"`,
      'Cache-Control': 'no-store',
    },
  });
}

// ── ZIP download ──────────────────────────────────────────────
// Builds an uncompressed (stored) ZIP archive in memory.
// Cloudflare Workers have no native zip API so we write the
// ZIP local-file records, central directory, and end-of-central-
// directory record manually using DataView / Uint8Array.

async function handleDownloadZip(request, env, orderId) {
  const authErr = requireAdmin(request, env);
  if (authErr) return authErr;

  const obj = await env.BUCKET.get(`orders/${orderId}/order.json`);
  if (!obj) return errorResponse('Order not found.', 404);

  let order;
  try {
    order = JSON.parse(await obj.text());
  } catch {
    return errorResponse('Corrupt order data.', 500);
  }

  const files = order.files || [];
  if (!files.length) return errorResponse('No files in this order.', 404);

  // Fetch all file contents
  const fileEntries = await Promise.all(files.map(async (f) => {
    const fObj = await env.BUCKET.get(f.r2_key);
    if (!fObj) return null;
    const data = new Uint8Array(await fObj.arrayBuffer());
    return { name: f.original_filename, data };
  }));

  const validEntries = fileEntries.filter(Boolean);

  // Build ZIP
  const zipBytes = buildZip(validEntries);

  return new Response(zipBytes, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="order-${orderId.slice(0, 8)}.zip"`,
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * Build an uncompressed ZIP archive.
 * @param {{ name: string, data: Uint8Array }[]} entries
 * @returns {Uint8Array}
 */
function buildZip(entries) {
  const parts = [];
  const centralDir = [];
  let offset = 0;

  const encoder = new TextEncoder();

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const nameLen   = nameBytes.length;
    const dataLen   = entry.data.length;
    const crc       = crc32(entry.data);

    // Local file header (30 bytes) + filename + data
    const localHeader = new Uint8Array(30 + nameLen);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0,  0x04034b50, true); // Local file header signature
    lv.setUint16(4,  20,         true); // Version needed (2.0)
    lv.setUint16(6,  0,          true); // General purpose bit flag
    lv.setUint16(8,  0,          true); // Compression method (stored)
    lv.setUint16(10, 0,          true); // Last mod time
    lv.setUint16(12, 0,          true); // Last mod date
    lv.setUint32(14, crc,        true); // CRC-32
    lv.setUint32(18, dataLen,    true); // Compressed size
    lv.setUint32(22, dataLen,    true); // Uncompressed size
    lv.setUint16(26, nameLen,    true); // File name length
    lv.setUint16(28, 0,          true); // Extra field length
    localHeader.set(nameBytes, 30);

    parts.push(localHeader, entry.data);

    // Central directory record (46 bytes) + filename
    const cdRecord = new Uint8Array(46 + nameLen);
    const cv = new DataView(cdRecord.buffer);
    cv.setUint32(0,  0x02014b50, true); // Central directory file header signature
    cv.setUint16(4,  20,         true); // Version made by
    cv.setUint16(6,  20,         true); // Version needed
    cv.setUint16(8,  0,          true); // General purpose bit flag
    cv.setUint16(10, 0,          true); // Compression method (stored)
    cv.setUint16(12, 0,          true); // Last mod time
    cv.setUint16(14, 0,          true); // Last mod date
    cv.setUint32(16, crc,        true); // CRC-32
    cv.setUint32(20, dataLen,    true); // Compressed size
    cv.setUint32(24, dataLen,    true); // Uncompressed size
    cv.setUint16(28, nameLen,    true); // File name length
    cv.setUint16(30, 0,          true); // Extra field length
    cv.setUint16(32, 0,          true); // File comment length
    cv.setUint16(34, 0,          true); // Disk number start
    cv.setUint16(36, 0,          true); // Internal file attributes
    cv.setUint32(38, 0,          true); // External file attributes
    cv.setUint32(42, offset,     true); // Relative offset of local header
    cdRecord.set(nameBytes, 46);

    centralDir.push(cdRecord);
    offset += localHeader.length + dataLen;
  }

  const cdOffset = offset;
  const cdBytes  = concat(centralDir);
  const cdSize   = cdBytes.length;

  // End of central directory record (22 bytes)
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0,  0x06054b50,      true); // End of central directory signature
  ev.setUint16(4,  0,               true); // Disk number
  ev.setUint16(6,  0,               true); // Disk with start of central directory
  ev.setUint16(8,  entries.length,  true); // Entries on this disk
  ev.setUint16(10, entries.length,  true); // Total entries
  ev.setUint32(12, cdSize,          true); // Size of central directory
  ev.setUint32(16, cdOffset,        true); // Offset of start of central directory
  ev.setUint16(20, 0,               true); // Comment length

  return concat([...parts, cdBytes, eocd]);
}

function concat(arrays) {
  const total  = arrays.reduce((n, a) => n + a.length, 0);
  const result = new Uint8Array(total);
  let offset   = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

// CRC-32 lookup table
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  return table;
})();

function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ── Scheduled cleanup ─────────────────────────────────────────

async function handleScheduled(env) {
  const listing  = await env.BUCKET.list({ prefix: 'orders/', delimiter: '/' });
  const prefixes = listing.delimitedPrefixes || [];
  const now      = Date.now();

  for (const prefix of prefixes) {
    const metaObj = await env.BUCKET.get(`${prefix}order.json`);
    if (!metaObj) continue;

    let order;
    try {
      order = JSON.parse(await metaObj.text());
    } catch {
      continue;
    }

    const createdAt   = new Date(order.created_at).getTime();
    const completedAt = order.completed_at ? new Date(order.completed_at).getTime() : null;

    const shouldDelete =
      // Completed orders past retention window
      (order.status === 'Completed' && completedAt && (now - completedAt > RETENTION_COMPLETED_MS)) ||
      // Stale New/In Progress orders past longer window
      (['New', 'In Progress'].includes(order.status) && (now - createdAt > RETENTION_STALE_MS));

    if (!shouldDelete) continue;

    // Delete all objects under this order prefix
    const all = await env.BUCKET.list({ prefix });
    const keys = (all.objects || []).map(o => o.key);
    if (keys.length) {
      await env.BUCKET.delete(keys);
    }
  }
}

// ── Router ────────────────────────────────────────────────────

const ROUTE_PATTERNS = [
  { method: 'POST',  pattern: /^\/api\/orders$/,                                       handler: (req, env, m) => handleOrderCreate(req, env) },
  { method: 'GET',   pattern: /^\/api\/admin\/orders$/,                                handler: (req, env, m) => handleListOrders(req, env) },
  { method: 'GET',   pattern: /^\/api\/admin\/orders\/([^/]+)$/,                       handler: (req, env, m) => handleGetOrder(req, env, m[1]) },
  { method: 'PATCH', pattern: /^\/api\/admin\/orders\/([^/]+)\/status$/,               handler: (req, env, m) => handleUpdateStatus(req, env, m[1]) },
  { method: 'DELETE',pattern: /^\/api\/admin\/orders\/([^/]+)$/,                       handler: (req, env, m) => handleDeleteOrder(req, env, m[1]) },
  { method: 'GET',   pattern: /^\/api\/admin\/orders\/([^/]+)\/files\/([^/]+)$/,       handler: (req, env, m) => handleDownloadFile(req, env, m[1], m[2]) },
  { method: 'GET',   pattern: /^\/api\/admin\/orders\/([^/]+)\/zip$/,                  handler: (req, env, m) => handleDownloadZip(req, env, m[1]) },
];

// ── Export ────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const url      = new URL(request.url);
    const pathname = url.pathname;
    const method   = request.method.toUpperCase();

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // API routing
    if (pathname.startsWith('/api/')) {
      for (const route of ROUTE_PATTERNS) {
        if (route.method !== method) continue;
        const match = pathname.match(route.pattern);
        if (match) {
          try {
            const res = await route.handler(request, env, match);
            // Attach CORS headers
            const headers = new Headers(res.headers);
            for (const [k, v] of Object.entries(corsHeaders())) headers.set(k, v);
            return new Response(res.body, { status: res.status, headers });
          } catch (err) {
            console.error('Worker error:', err);
            return errorResponse('Internal server error', 500);
          }
        }
      }
      return errorResponse('Not found', 404);
    }

    // Static assets fallback
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not found', { status: 404 });
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(handleScheduled(env));
  },
};
