/**
 * customer.js — PrintQueuePro customer intake form
 * Handles file selection, per-file size/quantity rows,
 * FormData submission, and confirmation screen.
 */

// ── Constants ────────────────────────────────────────────────
const ALLOWED_EXTENSIONS = ['pdf', 'dwg', 'jpg', 'jpeg', 'png'];
const MAX_FILES = 20;
const MAX_FILE_SIZE_MB = 50; // per-file guard (100 MB total Worker limit)
const PAPER_SIZES = ['A4', 'A3', 'A2', 'A1', 'A0'];

// ── State ─────────────────────────────────────────────────────
/** @type {File[]} */
let selectedFiles = [];

// ── DOM refs ─────────────────────────────────────────────────
const orderForm      = document.getElementById('order-form');
const fileInput      = document.getElementById('file-input');
const uploadZone     = document.getElementById('upload-zone');
const fileList       = document.getElementById('file-list');
const fileEmptyState = document.getElementById('file-empty-state');
const fileCountBadge = document.getElementById('file-count');
const submitBtn      = document.getElementById('submit-btn');
const errorBanner    = document.getElementById('error-banner');
const formView       = document.getElementById('form-view');
const progressView   = document.getElementById('progress-view');
const confirmView    = document.getElementById('confirmation-view');
const tokenDisplay   = document.getElementById('token-display');
const newOrderBtn    = document.getElementById('new-order-btn');

// ── File type helpers ─────────────────────────────────────────

function getExtension(filename) {
  return filename.split('.').pop().toLowerCase();
}

function getIconClass(filename) {
  const ext = getExtension(filename);
  const known = ['pdf', 'dwg', 'jpg', 'jpeg', 'png'];
  return known.includes(ext) ? ext : 'default';
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ── Render file list ──────────────────────────────────────────

function renderFileRows() {
  fileList.innerHTML = '';

  selectedFiles.forEach((file, index) => {
    const ext = getExtension(file.name);
    const iconClass = getIconClass(file.name);

    const row = document.createElement('div');
    row.className = 'file-row';
    row.setAttribute('role', 'listitem');
    row.innerHTML = `
      <div class="file-row-info">
        <div class="file-type-icon ${iconClass}" aria-hidden="true">${ext.toUpperCase()}</div>
        <div class="file-info-text">
          <div class="file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
          <div class="file-size-label">${formatBytes(file.size)}</div>
        </div>
      </div>

      <select
        name="sizes"
        aria-label="Print size for ${escapeHtml(file.name)}"
        data-index="${index}"
        class="file-size-select"
      >
        ${PAPER_SIZES.map(s => `<option value="${s}">${s}</option>`).join('')}
      </select>

      <input
        type="number"
        name="quantities"
        min="1"
        max="99"
        value="1"
        aria-label="Quantity for ${escapeHtml(file.name)}"
        data-index="${index}"
        class="file-qty-input"
      />

      <button
        type="button"
        class="remove-btn"
        data-index="${index}"
        aria-label="Remove ${escapeHtml(file.name)}"
      >
        <i class="bi bi-x-lg" aria-hidden="true"></i>
      </button>
    `;

    // Attach remove handler
    const removeBtn = row.querySelector('.remove-btn');
    removeBtn.addEventListener('click', () => removeFile(index));

    fileList.appendChild(row);
  });

  updateFileCountUI();
}

function removeFile(index) {
  selectedFiles.splice(index, 1);
  renderFileRows();
}

function updateFileCountUI() {
  const count = selectedFiles.length;
  const hasFiles = count > 0;

  fileCountBadge.textContent = count;
  fileCountBadge.style.display = hasFiles ? 'inline-flex' : 'none';
  fileEmptyState.classList.toggle('visible', !hasFiles);
  submitBtn.disabled = !hasFiles;
}

// ── File validation ───────────────────────────────────────────

function validateFiles(files) {
  const errors = [];

  if (selectedFiles.length + files.length > MAX_FILES) {
    errors.push(`You can upload at most ${MAX_FILES} files per order.`);
    return errors;
  }

  for (const file of files) {
    const ext = getExtension(file.name);
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      errors.push(`"${file.name}" is not an allowed file type (PDF, DWG, JPG, PNG only).`);
    }
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      errors.push(`"${file.name}" exceeds the ${MAX_FILE_SIZE_MB} MB per-file limit.`);
    }
  }

  return errors;
}

function addFiles(files) {
  const fileArray = Array.from(files);
  const errors = validateFiles(fileArray);

  if (errors.length) {
    showError(errors.join('\n'));
    return;
  }

  hideError();

  // Deduplicate by name
  const existingNames = new Set(selectedFiles.map(f => f.name));
  const newFiles = fileArray.filter(f => !existingNames.has(f.name));

  selectedFiles.push(...newFiles);
  renderFileRows();
}

// ── Drag & drop ───────────────────────────────────────────────

uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadZone.classList.add('drag-over');
});

uploadZone.addEventListener('dragleave', () => {
  uploadZone.classList.remove('drag-over');
});

uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length) {
    addFiles(fileInput.files);
    fileInput.value = ''; // reset so same file can be re-added after removal
  }
});

// ── Form validation ───────────────────────────────────────────

function validateForm() {
  let valid = true;

  const name = document.getElementById('name');
  const nameGroup = document.getElementById('name-group');
  if (!name.value.trim()) {
    nameGroup.classList.add('has-error');
    valid = false;
  } else {
    nameGroup.classList.remove('has-error');
  }

  const phone = document.getElementById('phone');
  const phoneGroup = document.getElementById('phone-group');
  const phoneVal = phone.value.trim();
  const phoneOk = /^[\d\s\+\-\(\)]{6,20}$/.test(phoneVal);
  if (!phoneOk) {
    phoneGroup.classList.add('has-error');
    valid = false;
  } else {
    phoneGroup.classList.remove('has-error');
  }

  if (selectedFiles.length === 0) {
    showError('Please add at least one file before submitting.');
    valid = false;
  }

  return valid;
}

// ── Submission ────────────────────────────────────────────────

orderForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();

  if (!validateForm()) return;

  // Collect per-file size + quantity from the rendered rows
  const sizeSelects = fileList.querySelectorAll('.file-size-select');
  const qtyInputs   = fileList.querySelectorAll('.file-qty-input');

  const formData = new FormData();
  formData.append('name',    document.getElementById('name').value.trim());
  formData.append('phone',   document.getElementById('phone').value.trim());
  formData.append('address', document.getElementById('address').value.trim());

  selectedFiles.forEach((file, i) => {
    formData.append('files',      file);
    formData.append('sizes',      sizeSelects[i]?.value || 'A4');
    formData.append('quantities', qtyInputs[i]?.value  || '1');
  });

  // Show upload progress
  submitBtn.disabled = true;
  formView.querySelector('.form-card').style.display = 'none';
  const progressCard = document.createElement('div');
  progressCard.className = 'form-card';
  progressCard.id = 'dynamic-progress-card';
  progressCard.innerHTML = `
    <div class="upload-progress-overlay active">
      <div class="big-spinner"></div>
      <p>Uploading your order…</p>
      <p style="font-size: var(--text-sm); color: var(--grey-400);">Please wait, this may take a moment.</p>
    </div>
  `;
  formView.appendChild(progressCard);

  try {
    const res = await fetch('/api/orders', { method: 'POST', body: formData });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Upload failed. Please try again.' }));
      throw new Error(err.error || `Server error (${res.status})`);
    }

    const data = await res.json();

    // Show confirmation
    tokenDisplay.textContent = String(data.token_number).padStart(2, '0');
    formView.style.display = 'none';
    confirmView.style.display = 'block';
    confirmView.classList.add('animate-scaleIn');

  } catch (err) {
    // Restore form
    formView.querySelector('.form-card').style.display = '';
    progressCard.remove();
    submitBtn.disabled = false;
    showError(err.message || 'Something went wrong. Please try again.');
  }
});

// ── New order reset ───────────────────────────────────────────

newOrderBtn.addEventListener('click', () => {
  selectedFiles = [];
  orderForm.reset();
  renderFileRows();
  hideError();
  confirmView.style.display = 'none';
  confirmView.classList.remove('animate-scaleIn');
  formView.style.display = 'block';
  // Remove the dynamically-created progress card if it exists
  const dynamicProgress = document.getElementById('dynamic-progress-card');
  if (dynamicProgress) dynamicProgress.remove();
  // Restore original form card visibility in case it was hidden
  const card = formView.querySelector('.form-card');
  if (card) card.style.display = '';
  submitBtn.disabled = true;
  document.getElementById('name-group').classList.remove('has-error');
  document.getElementById('phone-group').classList.remove('has-error');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ── Error helpers ─────────────────────────────────────────────

function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.classList.add('visible');
  errorBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideError() {
  errorBanner.classList.remove('visible');
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Init ──────────────────────────────────────────────────────
updateFileCountUI();

// ── Theme toggle (persisted) ─────────────────────────────────
(function initThemeToggleCustomer() {
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
