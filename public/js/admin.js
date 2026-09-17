/**
 * admin.js — PrintQueuePro admin portal
 * Handles login, order listing with polling, detail view,
 * status updates, and file downloads.
 */

// ── State ─────────────────────────────────────────────────────
let adminPassword = '';
let orders        = [];       // All fetched orders (raw)
let selectedId    = null;     // Currently selected order_id
let filterStatus  = 'all';    // 'all' | 'New' | 'In Progress' | 'Completed'
let searchQuery   = '';
let pollTimer     = null;
const POLL_MS     = 5000;

// ── DOM refs ─────────────────────────────────────────────────
const loginScreen      = document.getElementById('login-screen');
const adminApp         = document.getElementById('admin-app');
const loginForm        = document.getElementById('login-form');
const loginError       = document.getElementById('login-error');
const logoutBtn        = document.getElementById('logout-btn');
const orderList        = document.getElementById('order-list');
const orderCountLabel  = document.getElementById('order-count-label');
const searchInput      = document.getElementById('search-input');
const filterChips      = document.querySelectorAll('.filter-chip');
const detailPlaceholder= document.getElementById('detail-placeholder');
const detailContent    = document.getElementById('detail-content');
const refreshIndicator = document.getElementById('refresh-indicator');
const lastRefreshLabel = document.getElementById('last-refresh-label');
const toast            = document.getElementById('toast');
let toastTimer         = null;

// ── Helpers ───────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function statusBadgeClass(status) {
  if (status === 'New') return 'badge-new';
  if (status === 'In Progress') return 'badge-progress';
  if (status === 'Completed') return 'badge-done';
  return '';
}

function authHeaders() {
  return { 'X-Admin-Password': adminPassword };
}

function showToast(msg, type = '') {
  toast.textContent = msg;
  toast.className = 'toast show' + (type ? ' toast-' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 3200);
}

// ── Login ─────────────────────────────────────────────────────

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = document.getElementById('admin-password').value;
  if (!pw) return;

  // Try a quick auth-check by listing orders
  const res = await fetch('/api/admin/orders', {
    headers: { 'X-Admin-Password': pw },
  });

  if (res.ok) {
    adminPassword = pw;
    sessionStorage.setItem('pqp_pw', pw);
    loginError.classList.remove('visible');
    showAdminApp();
  } else {
    loginError.classList.add('visible');
    document.getElementById('admin-password').select();
  }
});

function showAdminApp() {
  loginScreen.style.display = 'none';
  adminApp.style.display = 'grid';
  startPolling();
}

logoutBtn.addEventListener('click', () => {
  sessionStorage.removeItem('pqp_pw');
  adminPassword = '';
  clearTimeout(pollTimer);
  orders = [];
  selectedId = null;
  adminApp.style.display = 'none';
  loginScreen.style.display = 'flex';
  document.getElementById('admin-password').value = '';
});

// Auto-login if password in sessionStorage
(function autoLogin() {
  const saved = sessionStorage.getItem('pqp_pw');
  if (saved) {
    adminPassword = saved;
    showAdminApp();
  }
})();

// ── Polling ───────────────────────────────────────────────────

function startPolling() {
  fetchOrders();
  pollTimer = setInterval(fetchOrders, POLL_MS);
}

async function fetchOrders() {
  refreshIndicator.classList.add('refreshing');
  try {
    const res = await fetch('/api/admin/orders', { headers: authHeaders() });

    if (res.status === 401) {
      clearInterval(pollTimer);
      sessionStorage.removeItem('pqp_pw');
      adminPassword = '';
      adminApp.style.display = 'none';
      loginScreen.style.display = 'flex';
      loginError.classList.add('visible');
      return;
    }

    if (!res.ok) throw new Error('Failed to fetch orders');

    const data = await res.json();
    const prev = orders.map(o => o.order_id);
    orders = data.orders || [];

    // Detect truly new orders (not in previous list)
    const newIds = orders
      .filter(o => !prev.includes(o.order_id))
      .map(o => o.order_id);

    renderOrderList(newIds);
    updateLastRefresh();

    // Refresh detail if selected order was updated
    if (selectedId) {
      const updated = orders.find(o => o.order_id === selectedId);
      if (updated) renderDetail(updated);
    }

  } catch (err) {
    console.error('Poll error:', err);
  } finally {
    refreshIndicator.classList.remove('refreshing');
  }
}

function updateLastRefresh() {
  lastRefreshLabel.textContent = 'Updated ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ── Order list ────────────────────────────────────────────────

function filteredOrders() {
  let list = [...orders];

  // Sort newest first
  list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  // Status filter
  if (filterStatus !== 'all') {
    list = list.filter(o => o.status === filterStatus);
  }

  // Search
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(o =>
      (o.customer_name || '').toLowerCase().includes(q) ||
      (o.phone_number  || '').toLowerCase().includes(q) ||
      (o.token_number  !== undefined && String(o.token_number).includes(q))
    );
  }

  return list;
}

function renderOrderList(newIds = []) {
  const list = filteredOrders();

  // Update count label
  const total = orders.length;
  orderCountLabel.textContent = total ? `(${total})` : '';

  orderList.innerHTML = '';

  if (list.length === 0) {
    orderList.innerHTML = `
      <div class="order-list-empty">
        <i class="bi bi-file-earmark-text" aria-hidden="true"></i>
        <p>${searchQuery || filterStatus !== 'all' ? 'No orders match your filter.' : 'No orders yet.'}</p>
      </div>
    `;
    return;
  }

  list.forEach(order => {
    const card = document.createElement('div');
    card.className = 'order-card' +
      (order.order_id === selectedId ? ' selected' : '') +
      (newIds.includes(order.order_id) ? ' new-pulse' : '');
    card.setAttribute('role', 'listitem');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `Order ${order.token_number} — ${order.customer_name}`);

    const fileCount = (order.files || []).length;

    card.innerHTML = `
      <div class="order-card-top">
        <div class="order-card-token">#${String(order.token_number).padStart(2, '0')}</div>
        <span class="badge ${statusBadgeClass(order.status)}">${escapeHtml(order.status)}</span>
      </div>
      <div class="order-card-name">${escapeHtml(order.customer_name)}</div>
      <div class="order-card-meta">
        <span>
          <i class="bi bi-telephone" aria-hidden="true"></i>
          ${escapeHtml(order.phone_number)}
        </span>
        <span>
          <i class="bi bi-file-earmark" aria-hidden="true"></i>
          ${fileCount} file${fileCount !== 1 ? 's' : ''}
        </span>
        <span>${timeAgo(order.created_at)}</span>
      </div>
    `;

    card.addEventListener('click', () => selectOrder(order.order_id));
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') selectOrder(order.order_id); });

    orderList.appendChild(card);
  });
}

// ── Order detail ──────────────────────────────────────────────

function selectOrder(orderId) {
  selectedId = orderId;

  // Update card selection state
  document.querySelectorAll('.order-card').forEach(el => {
    el.classList.toggle('selected', el.getAttribute('aria-label')?.includes('#'));
  });

  // Re-render list to update .selected class properly
  renderOrderList();

  const order = orders.find(o => o.order_id === orderId);
  if (order) renderDetail(order);
}

function renderDetail(order) {
  detailPlaceholder.style.display = 'none';
  detailContent.style.display = 'flex';

  // Header
  document.getElementById('detail-token').textContent = `Order #${String(order.token_number).padStart(2, '0')}`;
  document.getElementById('detail-name').textContent  = order.customer_name || '—';
  document.getElementById('detail-phone').textContent = order.phone_number  || '—';
  document.getElementById('detail-time').textContent  = timeAgo(order.created_at);

  const addrRow = document.getElementById('detail-address-row');
  if (order.address) {
    document.getElementById('detail-address').textContent = order.address;
    addrRow.style.display = 'flex';
  } else {
    addrRow.style.display = 'none';
  }

  // Status badge + select
  const badge = document.getElementById('detail-badge');
  badge.className = `badge ${statusBadgeClass(order.status)}`;
  badge.textContent = order.status;

  const sel = document.getElementById('status-select');
  sel.value = order.status;

  // Info card
  document.getElementById('info-name').textContent  = order.customer_name || '—';
  document.getElementById('info-phone').textContent = order.phone_number  || '—';
  document.getElementById('info-time').textContent  = formatDate(order.created_at);

  const infoAddrRow = document.getElementById('info-address-row');
  if (order.address) {
    document.getElementById('info-address').textContent = order.address;
    infoAddrRow.style.display = '';
  } else {
    infoAddrRow.style.display = 'none';
  }

  // Files
  const files = order.files || [];
  document.getElementById('files-count-label').textContent = `${files.length} file${files.length !== 1 ? 's' : ''}`;
  const filesList = document.getElementById('files-list');
  filesList.innerHTML = '';

  files.forEach(file => {
    const row = document.createElement('div');
    row.className = 'file-row-admin';
    row.innerHTML = `
      <div class="file-admin-info">
        <span class="file-admin-chip">${escapeHtml((file.file_type || '').toUpperCase() || getExt(file.original_filename))}</span>
        <span class="file-admin-name" title="${escapeHtml(file.original_filename)}">${escapeHtml(file.original_filename)}</span>
      </div>
      <span class="file-admin-chip">${escapeHtml(file.size || '—')}</span>
      <span class="file-admin-qty">×${file.quantity || 1}</span>
      <button class="file-download-btn" data-key="${escapeHtml(file.original_filename)}" data-orderid="${escapeHtml(order.order_id)}" aria-label="Download ${escapeHtml(file.original_filename)}">
        <i class="bi bi-download" aria-hidden="true"></i>
        Download
      </button>
    `;

    row.querySelector('.file-download-btn').addEventListener('click', () => {
      downloadFile(order.order_id, file.original_filename);
    });

    filesList.appendChild(row);
  });
}

function getExt(filename) {
  return (filename || '').split('.').pop().toUpperCase();
}

// ── Status update ─────────────────────────────────────────────

document.getElementById('update-status-btn').addEventListener('click', async () => {
  if (!selectedId) return;
  const newStatus = document.getElementById('status-select').value;
  const btn = document.getElementById('update-status-btn');
  btn.disabled = true;
  btn.textContent = '…';

  try {
    const res = await fetch(`/api/admin/orders/${selectedId}/status`, {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });

    if (!res.ok) throw new Error('Update failed');
    showToast('Status updated', 'success');
    await fetchOrders();

  } catch (err) {
    showToast('Failed to update status', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Update';
  }
});

// ── File download ─────────────────────────────────────────────

function downloadFile(orderId, filename) {
  const url = `/api/admin/orders/${orderId}/files/${encodeURIComponent(filename)}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;

  // Add auth via custom header doesn't work for <a> download —
  // instead, we fetch with auth and create a blob URL.
  fetch(url, { headers: authHeaders() })
    .then(res => {
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      return res.blob();
    })
    .then(blob => {
      const blobUrl = URL.createObjectURL(blob);
      a.href = blobUrl;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    })
    .catch(err => showToast('Download failed: ' + err.message, 'error'));
}

// ── ZIP download ──────────────────────────────────────────────

document.getElementById('download-zip-btn').addEventListener('click', async () => {
  if (!selectedId) return;
  const btn = document.getElementById('download-zip-btn');
  btn.disabled = true;
  const original = btn.innerHTML;
  btn.textContent = 'Preparing…';

  try {
    const res = await fetch(`/api/admin/orders/${selectedId}/zip`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`ZIP failed (${res.status})`);

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `order-${selectedId.slice(0, 8)}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);

  } catch (err) {
    showToast('ZIP download failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
});

// ── Delete order ──────────────────────────────────────────────

document.getElementById('delete-order-btn').addEventListener('click', async () => {
  if (!selectedId) return;

  const order = orders.find(o => o.order_id === selectedId);
  const label = order
    ? `Order #${String(order.token_number).padStart(2, '0')} (${order.customer_name})`
    : selectedId.slice(0, 8);

  if (!confirm(`Permanently delete ${label}?\n\nThis will remove the order and all its files from storage. This cannot be undone.`)) {
    return;
  }

  const btn = document.getElementById('delete-order-btn');
  btn.disabled = true;
  btn.textContent = 'Deleting…';

  try {
    const res = await fetch(`/api/admin/orders/${selectedId}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });

    if (!res.ok) throw new Error('Delete failed');

    showToast('Order deleted permanently', 'success');

    // Reset detail panel
    selectedId = null;
    detailContent.style.display = 'none';
    detailPlaceholder.style.display = 'flex';

    // Refresh list
    await fetchOrders();

  } catch (err) {
    showToast('Failed to delete order: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <i class="bi bi-trash" aria-hidden="true"></i>
      Delete Order
    `;
  }
});

// ── Search & filter ───────────────────────────────────────────

searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value.trim();
  renderOrderList();
});

filterChips.forEach(chip => {
  chip.addEventListener('click', () => {
    filterChips.forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    filterStatus = chip.dataset.filter;
    renderOrderList();
  });
});

// ── Theme toggle (persisted) ─────────────────────────────────
(function initThemeToggleAdmin() {
  const toggle = document.getElementById('theme-toggle');
  const stored = localStorage.getItem('pqp_theme') || 'light';
  function applyTheme(name) {
    if (name === 'dark') {
      document.documentElement.classList.add('theme-dark');
      if (toggle) toggle.innerHTML = '<i class="bi bi-sun-fill"></i>';
      localStorage.setItem('pqp_theme', 'dark');
    } else {
      document.documentElement.classList.remove('theme-dark');
      if (toggle) toggle.innerHTML = '<i class="bi bi-moon-fill"></i>';
      localStorage.setItem('pqp_theme', 'light');
    }
  }

  applyTheme(stored);

  if (!toggle) return;
  toggle.addEventListener('click', () => {
    const isDark = document.documentElement.classList.toggle('theme-dark');
    applyTheme(isDark ? 'dark' : 'light');
  });
})();
