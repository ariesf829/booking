import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const USE_SUPABASE_AUTH = true;
const SUPABASE_CONFIGURED = USE_SUPABASE_AUTH && !SUPABASE_URL.includes('your-project') && !SUPABASE_ANON_KEY.includes('your-anon-public-key');
const AUTH_REDIRECT_URL = `${window.location.origin}${window.location.pathname}`;
const HOURS = Array.from({ length: 15 }, (_, index) => index + 7);
const COURTS = [
  { id: 1, name: 'Court 1', detail: 'Outdoor · acrylic surface' },
  { id: 2, name: 'Court 2', detail: 'Outdoor · acrylic surface' }
];
const BOOKING_RATE = 350;
const today = new Date();
let selectedDate = formatDate(today);
let selection = [];
let holdInterval;
let isSignUp = false;
let currentUser = JSON.parse(localStorage.getItem('rally-user') || 'null');
const DEMO_ADMIN = { email: 'admin@rallyreserve.test', password: 'admin123', name: 'Rally Admin', role: 'admin' };

const storedBookings = JSON.parse(localStorage.getItem('rally-bookings') || '[]');
let bookings = storedBookings.filter(booking => {
  if (booking.status === 'pending' && Date.now() - booking.createdAt >= 10 * 60 * 1000) booking.status = 'cancelled';
  return true;
});
pruneExpiredReceipts();

const dateStrip = document.querySelector('#dateStrip');
const courtGrid = document.querySelector('#courtGrid');
const continueButton = document.querySelector('#continueButton');
const selectedSlotText = document.querySelector('#selectedSlotText');
const checkoutModal = document.querySelector('#checkoutModal');
const checkoutDetails = document.querySelector('#checkoutDetails');
const bookingCard = document.querySelector('#bookingCard');
const toast = document.querySelector('#toast');
const profileButton = document.querySelector('#profileButton');
const logoutButton = document.querySelector('#logoutButton');
const authModal = document.querySelector('#authModal');
const authForm = document.querySelector('#authForm');
const adminPanel = document.querySelector('#adminPanel');
const receiptModal = document.querySelector('#receiptModal');
const receiptPreviewImage = document.querySelector('#receiptPreviewImage');
const receiptMetaText = document.querySelector('#receiptMetaText');
const checkoutReceiptPreview = document.querySelector('#checkoutReceiptPreview');
const receiptPreviewShell = document.querySelector('#receiptPreviewShell');
const clearReceiptButton = document.querySelector('#clearReceiptButton');
const demoHint = document.querySelector('#demoHint');

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateLabel(date, format) {
  return new Intl.DateTimeFormat('en-PH', format).format(date);
}

function renderDates() {
  dateStrip.innerHTML = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() + index);
    const dateValue = formatDate(date);
    return `<button class="date-button ${dateValue === selectedDate ? 'selected' : ''}" data-date="${dateValue}" role="tab" aria-selected="${dateValue === selectedDate}"><strong>${date.getDate()}</strong><span>${index === 0 ? 'Today' : dateLabel(date, { weekday: 'short' })}</span></button>`;
  }).join('');
  dateStrip.querySelectorAll('.date-button').forEach(button => button.addEventListener('click', () => {
    selectedDate = button.dataset.date;
    selection = [];
    renderDates();
    renderCourts();
    renderSummary();
  }));
}

function slotKey(courtId, hour) {
  return `${courtId}:${hour}`;
}

function isSelectedSlot(courtId, hour) {
  return selection.some(item => item.courtId === courtId && item.hour === hour);
}

function isUnavailable(courtId, hour) {
  const selectedKeys = new Set(selection.map(item => slotKey(item.courtId, item.hour)));
  return bookings.some(booking => booking.date === selectedDate && booking.courtId === courtId && booking.hour === hour && ['pending', 'confirmed'].includes(booking.status) && !selectedKeys.has(slotKey(courtId, hour)));
}

function normalizeBooking(booking) {
  return { ...booking, courtId: booking.courtId ?? booking.court_number, hour: booking.hour ?? booking.start_hour, date: booking.date ?? booking.booking_date, createdAt: booking.createdAt ?? new Date(booking.created_at).getTime(), fullName: booking.fullName ?? booking.profiles?.full_name, phone: booking.phone ?? booking.profiles?.phone_number, reference: booking.reference ?? booking.gcash_reference };
}

async function attachReceiptUrls(bookingList) {
  if (!SUPABASE_CONFIGURED) return bookingList;
  return Promise.all(bookingList.map(async booking => {
    if (!booking.payment_proof_path || booking.proofDataUrl) return booking;
    const { data, error } = await supabase.storage.from('payment-proofs').createSignedUrl(booking.payment_proof_path, 3600);
    return error ? booking : { ...booking, proofDataUrl: data?.signedUrl || '' };
  }));
}

async function loadBookings() {
  if (!SUPABASE_CONFIGURED || !currentUser) return;
  let query = supabase.from('bookings').select('*, profiles(full_name, phone_number)').order('created_at', { ascending: false });
  const { data, error } = await query;
  if (error) { showToast(error.message); return; }
  bookings = await attachReceiptUrls((data || []).map(normalizeBooking));
  renderCourts(); renderMyBookings();
  if (currentUser.role === 'admin' && !adminPanel.classList.contains('hidden')) renderAdmin();
}

function renderCourts() {
  courtGrid.innerHTML = COURTS.map(court => `<article class="court-card"><div class="court-card-header"><div><h3>${court.name}</h3><small>${court.detail}</small></div><span class="court-badge">AVAILABLE</span></div><div class="slot-grid">${HOURS.map(hour => { const unavailable = isUnavailable(court.id, hour); const active = isSelectedSlot(court.id, hour); return `<button class="slot-button ${unavailable ? 'booked' : ''} ${active ? 'selected' : ''}" ${unavailable ? 'disabled' : ''} data-court="${court.id}" data-hour="${hour}">${String(hour).padStart(2, '0')}:00</button>`; }).join('')}</div></article>`).join('');
  courtGrid.querySelectorAll('.slot-button:not(:disabled)').forEach(button => button.addEventListener('click', () => {
    const courtId = Number(button.dataset.court);
    const hour = Number(button.dataset.hour);
    const index = selection.findIndex(item => item.courtId === courtId && item.hour === hour);
    if (index >= 0) {
      selection.splice(index, 1);
    } else {
      selection.push({ courtId, hour });
    }
    renderCourts();
    renderSummary();
  }));
}

function renderSummary() {
  if (!selection.length) {
    selectedSlotText.textContent = 'Choose a court and time';
    continueButton.disabled = true;
    return;
  }
  const total = selection.length * BOOKING_RATE;
  selectedSlotText.textContent = `${selection.length} slot${selection.length > 1 ? 's' : ''} selected · ${selection.length > 1 ? `₱ ${total}` : `₱ ${BOOKING_RATE}`}`;
  continueButton.disabled = false;
}

function openCheckout() {
  if (!selection.length) return;
  if (!currentUser) { authModal.classList.remove('hidden'); showAuthMode(false); return; }
  showCheckout();
}

function showCheckout() {
  const slotSummary = selection.map(slot => {
    const court = COURTS.find(item => item.id === slot.courtId);
    return `<div><strong>${court.name} · ${String(slot.hour).padStart(2, '0')}:00 - ${String(slot.hour + 1).padStart(2, '0')}:00</strong></div>`;
  }).join('');
  const total = selection.length * BOOKING_RATE;
  checkoutDetails.innerHTML = `${slotSummary}<div class="checkout-total">${dateLabel(new Date(`${selectedDate}T12:00:00`), { weekday: 'long', month: 'long', day: 'numeric' })} · Total: ₱ ${total}</div>`;
  checkoutModal.classList.remove('hidden');
  startTimer();
}

function startTimer() {
  let remaining = 600;
  const timer = document.querySelector('#holdTimer');
  clearInterval(holdInterval);
  const tick = () => { timer.textContent = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`; if (remaining <= 0) { clearInterval(holdInterval); closeCheckout(); showToast('Your hold expired. Please choose another slot.'); } remaining -= 1; };
  tick();
  holdInterval = setInterval(tick, 1000);
}

function closeCheckout() { clearInterval(holdInterval); checkoutModal.classList.add('hidden'); }
function showAuthMode(signUp) {
  isSignUp = signUp;
  document.querySelector('#authTitle').textContent = signUp ? 'Join the club.' : 'Welcome back.';
  document.querySelector('#authIntro').textContent = signUp ? 'Create an account to reserve your next hour.' : 'Sign in to manage bookings and reserve your next hour.';
  document.querySelector('#authSubmit').innerHTML = `${signUp ? 'Create account' : 'Sign in'} <i data-lucide="${signUp ? 'user-plus' : 'log-in'}"></i>`;
  document.querySelector('#toggleAuth').textContent = signUp ? 'I already have an account' : 'Create a customer account';
  demoHint.classList.toggle('hidden', signUp);
  window.lucide?.createIcons();
}
function closeAuth() { authModal.classList.add('hidden'); }
function updateProfile() {
  profileButton.textContent = currentUser ? (currentUser.name || currentUser.email).slice(0, 2).toUpperCase() : 'Login/Sign-up';
  profileButton.classList.toggle('signed-out', !currentUser);
  profileButton.setAttribute('aria-label', currentUser ? 'Open account menu' : 'Sign in');
  logoutButton.classList.toggle('hidden', !currentUser);
}
function handleLogout() {
  if (SUPABASE_CONFIGURED) {
    supabase.auth.signOut().catch(() => {});
  }
  currentUser = null;
  localStorage.removeItem('rally-user');
  updateProfile();
  closeAuth();
  closeCheckout();
  closeAdmin();
  showToast('You have been signed out.');
}
function openAdmin() {
  adminPanel.classList.remove('hidden');
  document.querySelector('main').classList.add('hidden');
  renderAdmin();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function closeAdmin() { adminPanel.classList.add('hidden'); document.querySelector('main').classList.remove('hidden'); }
function pruneExpiredReceipts() {
  const oneMonthMs = 30 * 24 * 60 * 60 * 1000;
  bookings = bookings.map(booking => {
    if (!booking.proofDataUrl) return booking;
    if (Date.now() - Number(booking.createdAt || 0) > oneMonthMs) {
      return { ...booking, proofDataUrl: '', reference: booking.reference || 'Receipt expired' };
    }
    return booking;
  });
  saveBookings();
}

function openReceiptPreview(bookingId) {
  const booking = bookings.find(item => item.id === bookingId);
  if (!booking || !booking.proofDataUrl) {
    showToast('No receipt uploaded for this booking.');
    return;
  }
  receiptPreviewImage.src = booking.proofDataUrl;
  receiptMetaText.textContent = `${booking.fullName || 'Customer'} · ${booking.reference || 'GCash reference'} · ${dateLabel(new Date(`${booking.date}T12:00:00`), { month: 'short', day: 'numeric', year: 'numeric' })}`;
  receiptModal.classList.remove('hidden');
}

function receiptThumbnail(booking) {
  if (!booking.proofDataUrl) return '<span class="receipt-missing">No receipt</span>';
  return `<button class="receipt-thumbnail-button" type="button" data-receipt-id="${booking.id}" aria-label="View payment receipt"><img class="receipt-thumb" src="${booking.proofDataUrl}" alt="Payment receipt thumbnail"></button>`;
}

function renderAdmin() {
  const pending = bookings.filter(booking => booking.status === 'pending').length;
  const confirmed = bookings.filter(booking => booking.status === 'confirmed').length;
  document.querySelector('#adminStats').innerHTML = `<div><span>Pending review</span><strong>${pending}</strong></div><div><span>Confirmed</span><strong>${confirmed}</strong></div><div><span>Total records</span><strong>${bookings.length}</strong></div>`;
  document.querySelector('#adminBookingRows').innerHTML = bookings.length ? bookings.slice().sort((a, b) => b.createdAt - a.createdAt).map(booking => { const court = COURTS.find(item => item.id === booking.courtId); return `<tr><td><strong>${booking.fullName || 'Demo customer'}</strong><small>${booking.phone || 'No phone'}</small></td><td>${court?.name || `Court ${booking.courtId}`}<small>${String(booking.hour).padStart(2, '0')}:00 - ${String(booking.hour + 1).padStart(2, '0')}:00</small></td><td>${dateLabel(new Date(`${booking.date}T12:00:00`), { month: 'short', day: 'numeric', year: 'numeric' })}</td><td>${receiptThumbnail(booking)}</td><td><small>${booking.reference || 'Proof uploaded'}</small></td><td><span class="status-pill ${booking.status}">${booking.status}</span></td><td><div class="action-stack">${booking.proofDataUrl ? `<button class="table-action preview" data-action="preview" data-id="${booking.id}">Preview</button>` : ''}${booking.status === 'pending' ? `<button class="table-action confirm" data-action="confirmed" data-id="${booking.id}">Confirm</button><button class="table-action cancel" data-action="cancelled" data-id="${booking.id}">Cancel</button>` : '<span class="muted-action">No action</span>'}</div></td></tr>`; }).join('') : '<tr><td colspan="7" class="table-empty">No booking records yet.</td></tr>';
  document.querySelectorAll('.receipt-thumbnail-button').forEach(button => button.addEventListener('click', () => openReceiptPreview(button.dataset.receiptId)));
  document.querySelectorAll('.table-action').forEach(button => {
    button.addEventListener('click', async () => {
      const booking = bookings.find(item => item.id === button.dataset.id);
      if (!booking) return;
      if (button.dataset.action === 'preview') {
        openReceiptPreview(booking.id);
        return;
      }
      if (SUPABASE_CONFIGURED) { const { error } = await supabase.from('bookings').update({ status: button.dataset.action, ...(button.dataset.action === 'confirmed' ? { confirmed_at: new Date().toISOString() } : {}) }).eq('id', booking.id); if (error) { showToast(error.message); return; } await loadBookings(); } else { booking.status = button.dataset.action; saveBookings(); renderAdmin(); renderCourts(); renderMyBookings(); } showToast(`Booking ${button.dataset.action}.`); });
  });
}
function saveBookings() { localStorage.setItem('rally-bookings', JSON.stringify(bookings)); }
function showToast(message) { toast.querySelector('span').textContent = message; toast.classList.remove('hidden'); setTimeout(() => toast.classList.add('hidden'), 4000); }

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) { resolve(''); return; }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Unable to read uploaded receipt.'));
    reader.readAsDataURL(file);
  });
}

function handleAuthError(error) {
  const message = error?.message || 'Authentication failed.';
  const normalized = message.toLowerCase();
  if (normalized.includes('rate limit') || normalized.includes('too many requests') || error?.status === 429) {
    showToast('Email rate limit reached. Please wait a few minutes and try again, or use the demo admin login.');
    return;
  }
  if (normalized.includes('user already registered')) {
    showToast('This email is already registered. Please sign in instead.');
    return;
  }
  showToast(message);
}

function handleBookingError(error) {
  const message = error?.message || 'Unable to submit booking.';
  if (message.toLowerCase().includes('row-level security') || message.toLowerCase().includes('policy')) {
    showToast('Supabase blocked the booking because the logged-in user is not allowed to insert into bookings. Check the auth session and the bookings insert policy.');
    return;
  }
  showToast(message);
}

function resetReceiptPreview() {
  checkoutReceiptPreview.src = '';
  receiptPreviewShell.classList.add('hidden');
  const fileInput = document.querySelector('#checkoutForm input[name="proof"]');
  if (fileInput) fileInput.value = '';
}

function renderMyBookings() {
  pruneExpiredReceipts();
  const ownBookings = currentUser?.role === 'admin' ? bookings : bookings.filter(booking => booking.user_id === currentUser?.id);
  if (!ownBookings.length) { bookingCard.innerHTML = '<div class="empty-state"><div class="empty-icon"><i data-lucide="calendar-days"></i></div><div><strong>No bookings yet</strong><p>Your court bookings will appear here.</p></div></div>'; window.lucide?.createIcons(); return; }
  bookingCard.innerHTML = ownBookings.slice().sort((a, b) => b.createdAt - a.createdAt).map(booking => {
    const court = COURTS.find(item => item.id === booking.courtId);
    const statusLabel = booking.status === 'pending' ? 'PAYMENT PENDING' : booking.status.toUpperCase();
    const receiptMarkup = `<div class="booking-receipt"><div><span>Proof receipt</span>${receiptThumbnail(booking)}</div><div><span>GCash ref</span><strong>${booking.reference || 'Not provided'}</strong></div></div>`;
    return `<div class="booking-item"><div><span class="court-badge">${statusLabel}</span><h3>${court?.name || `Court ${booking.courtId}`} · ${String(booking.hour).padStart(2, '0')}:00</h3><p>${dateLabel(new Date(`${booking.date}T12:00:00`), { weekday: 'long', month: 'short', day: 'numeric' })}</p>${receiptMarkup}</div><strong>₱ ${booking.amount || 350}</strong></div>`;
  }).join('');
  bookingCard.querySelectorAll('.receipt-thumbnail-button').forEach(button => button.addEventListener('click', () => openReceiptPreview(button.dataset.receiptId)));
}

continueButton.addEventListener('click', openCheckout);
profileButton.addEventListener('click', () => { if (!currentUser) { showAuthMode(false); authModal.classList.remove('hidden'); } else if (currentUser.role === 'admin') openAdmin(); else showToast(`Signed in as ${currentUser.name || currentUser.email}.`); });
logoutButton.addEventListener('click', handleLogout);
document.querySelector('#closeModal').addEventListener('click', () => { closeCheckout(); resetReceiptPreview(); });
document.querySelector('#closeReceiptModal').addEventListener('click', () => receiptModal.classList.add('hidden'));
receiptModal.addEventListener('click', event => { if (event.target === receiptModal) receiptModal.classList.add('hidden'); });
document.querySelector('#closeAuth').addEventListener('click', closeAuth);
clearReceiptButton.addEventListener('click', resetReceiptPreview);
document.querySelector('#toggleAuth').addEventListener('click', () => showAuthMode(!isSignUp));
document.querySelector('#closeAdmin').addEventListener('click', closeAdmin);
checkoutModal.addEventListener('click', event => { if (event.target === checkoutModal) closeCheckout(); });
authForm.addEventListener('submit', async event => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const email = formData.get('email').toLowerCase();
  const password = formData.get('password');
  if (SUPABASE_CONFIGURED) {
    let result;
    if (isSignUp) {
      result = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: AUTH_REDIRECT_URL, data: { full_name: email.split('@')[0], phone_number: '' } } });
    } else {
      result = await supabase.auth.signInWithPassword({ email, password });
    }
    if (result.error) { handleAuthError(result.error); return; }
    if (!result.data.session) {
      currentUser = null;
      localStorage.removeItem('rally-user');
      updateProfile();
      showToast('Check your email to confirm your account, then sign in before booking.');
      return;
    }
    currentUser = result.data.session.user;
    const { data: profile } = await supabase.from('profiles').select('full_name, role').eq('id', currentUser.id).single();
    currentUser.name = profile?.full_name || currentUser.user_metadata?.full_name || email.split('@')[0];
    currentUser.role = profile?.role || 'customer';
  } else if (isSignUp) {
    currentUser = { email, name: email.split('@')[0], role: 'customer' };
    showToast('Account created. You are signed in.');
  } else if (email === DEMO_ADMIN.email && password === DEMO_ADMIN.password) {
    currentUser = { email: DEMO_ADMIN.email, name: DEMO_ADMIN.name, role: 'admin' };
    showToast('Admin access granted.');
  } else {
    currentUser = { email, name: email.split('@')[0], role: 'customer' };
    showToast('Signed in in demo mode.');
  }
  localStorage.setItem('rally-user', JSON.stringify(currentUser)); updateProfile(); closeAuth();
  await loadBookings();
  if (selection.length) showCheckout();
});
document.querySelector('#checkoutForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!currentUser?.id) {
    showToast('Please sign in again before submitting a booking.');
    return;
  }
  if (SUPABASE_CONFIGURED) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      currentUser = null;
      localStorage.removeItem('rally-user');
      updateProfile();
      showToast('Your session expired. Please sign in again before submitting.');
      closeCheckout();
      showAuthMode(false);
      authModal.classList.remove('hidden');
      return;
    }
    currentUser = session.user;
  }
  const formData = new FormData(event.currentTarget);
  const proof = formData.get('proof');
  if (!proof || !proof.name) {
    showToast('Please upload a payment screenshot before submitting.');
    return;
  }
  const reference = String(formData.get('reference') || '').trim();
  const fullName = String(formData.get('fullName') || '').trim();
  const phone = String(formData.get('phone') || '').trim();
  const proofDataUrl = await readFileAsDataUrl(proof).catch(() => '');
  const paymentProofPath = `${currentUser.id}/${crypto.randomUUID()}-${proof.name}`;
  if (SUPABASE_CONFIGURED) {
    const { error: profileError } = await supabase.from('profiles').update({ full_name: fullName, phone_number: phone }).eq('id', currentUser.id);
    if (profileError) { showToast(profileError.message); return; }
    const bookingRows = selection.map(slot => ({ user_id: currentUser.id, court_number: slot.courtId, booking_date: selectedDate, start_hour: slot.hour, gcash_reference: reference, payment_proof_path: paymentProofPath, status: 'pending' }));
    const upload = await supabase.storage.from('payment-proofs').upload(paymentProofPath, proof);
    if (upload.error) { showToast(upload.error.message); return; }
    const { error } = await supabase.from('bookings').insert(bookingRows);
    if (error) { handleBookingError(error); return; }
    await loadBookings();
  } else {
    selection.forEach(slot => {
      bookings.push({ id: crypto.randomUUID(), user_id: currentUser.id || currentUser.email, ...slot, date: selectedDate, fullName, phone, reference, proofDataUrl, status: 'pending', createdAt: Date.now() });
    });
    saveBookings(); renderCourts(); renderMyBookings();
  }
  selection = []; renderSummary(); closeCheckout(); event.currentTarget.reset(); resetReceiptPreview(); showToast('Booking held. Upload received for review.');
});

const checkoutProofInput = document.querySelector('#checkoutForm input[name="proof"]');
checkoutProofInput.addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) {
    resetReceiptPreview();
    return;
  }
  const previewUrl = await readFileAsDataUrl(file).catch(() => '');
  if (!previewUrl) {
    resetReceiptPreview();
    return;
  }
  checkoutReceiptPreview.src = previewUrl;
  receiptPreviewShell.classList.remove('hidden');
  checkoutReceiptPreview.alt = `Preview for ${file.name}`;
});

renderDates();
renderCourts();
renderSummary();
renderMyBookings();
updateProfile();
window.lucide?.createIcons();

async function initializeAuth() {
  if (!SUPABASE_CONFIGURED) return;
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    currentUser = session.user;
    const { data: profile } = await supabase.from('profiles').select('full_name, role').eq('id', currentUser.id).single();
    currentUser.name = profile?.full_name || currentUser.email;
    currentUser.role = profile?.role || 'customer';
    updateProfile();
    await loadBookings();
  } else {
    currentUser = null;
    localStorage.removeItem('rally-user');
    bookings = [];
    updateProfile();
    renderCourts();
    renderMyBookings();
  }
  supabase.auth.onAuthStateChange((_event, sessionChange) => {
    currentUser = sessionChange?.user || null;
    if (!currentUser) { bookings = []; renderCourts(); renderMyBookings(); }
    updateProfile();
  });
}

initializeAuth();
