const HOURS = Array.from({ length: 15 }, (_, index) => index + 7);
const COURTS = [
  { id: 1, name: 'Court 1', detail: 'Outdoor · acrylic surface' },
  { id: 2, name: 'Court 2', detail: 'Outdoor · acrylic surface' }
];
const today = new Date();
let selectedDate = formatDate(today);
let selection = null;
let holdInterval;
let isSignUp = false;
let currentUser = JSON.parse(localStorage.getItem('rally-user') || 'null');
const DEMO_ADMIN = { email: 'admin@rallyreserve.test', password: 'admin123', name: 'Rally Admin', role: 'admin' };

const storedBookings = JSON.parse(localStorage.getItem('rally-bookings') || '[]');
let bookings = storedBookings.filter(booking => {
  if (booking.status === 'pending' && Date.now() - booking.createdAt >= 10 * 60 * 1000) booking.status = 'cancelled';
  return true;
});

const dateStrip = document.querySelector('#dateStrip');
const courtGrid = document.querySelector('#courtGrid');
const continueButton = document.querySelector('#continueButton');
const selectedSlotText = document.querySelector('#selectedSlotText');
const checkoutModal = document.querySelector('#checkoutModal');
const checkoutDetails = document.querySelector('#checkoutDetails');
const bookingCard = document.querySelector('#bookingCard');
const toast = document.querySelector('#toast');
const profileButton = document.querySelector('#profileButton');
const authModal = document.querySelector('#authModal');
const authForm = document.querySelector('#authForm');
const adminPanel = document.querySelector('#adminPanel');
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
    selection = null;
    renderDates();
    renderCourts();
    renderSummary();
  }));
}

function isUnavailable(courtId, hour) {
  return bookings.some(booking => booking.date === selectedDate && booking.courtId === courtId && booking.hour === hour && ['pending', 'confirmed'].includes(booking.status));
}

function renderCourts() {
  courtGrid.innerHTML = COURTS.map(court => `<article class="court-card"><div class="court-card-header"><div><h3>${court.name}</h3><small>${court.detail}</small></div><span class="court-badge">AVAILABLE</span></div><div class="slot-grid">${HOURS.map(hour => { const unavailable = isUnavailable(court.id, hour); const active = selection?.courtId === court.id && selection?.hour === hour; return `<button class="slot-button ${unavailable ? 'booked' : ''} ${active ? 'selected' : ''}" ${unavailable ? 'disabled' : ''} data-court="${court.id}" data-hour="${hour}">${String(hour).padStart(2, '0')}:00</button>`; }).join('')}</div></article>`).join('');
  courtGrid.querySelectorAll('.slot-button:not(:disabled)').forEach(button => button.addEventListener('click', () => {
    selection = { courtId: Number(button.dataset.court), hour: Number(button.dataset.hour) };
    renderCourts();
    renderSummary();
  }));
}

function renderSummary() {
  if (!selection) {
    selectedSlotText.textContent = 'Choose a court and time';
    continueButton.disabled = true;
    return;
  }
  const court = COURTS.find(item => item.id === selection.courtId);
  selectedSlotText.textContent = `${court.name} · ${String(selection.hour).padStart(2, '0')}:00 · ${dateLabel(new Date(`${selectedDate}T12:00:00`), { month: 'short', day: 'numeric' })}`;
  continueButton.disabled = false;
}

function openCheckout() {
  if (!selection) return;
  if (!currentUser) { authModal.classList.remove('hidden'); showAuthMode(false); return; }
  showCheckout();
}

function showCheckout() {
  const court = COURTS.find(item => item.id === selection.courtId);
  checkoutDetails.innerHTML = `<strong>${court.name} · ${String(selection.hour).padStart(2, '0')}:00 - ${String(selection.hour + 1).padStart(2, '0')}:00</strong>${dateLabel(new Date(`${selectedDate}T12:00:00`), { weekday: 'long', month: 'long', day: 'numeric' })} · ₱ 350`;
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
  profileButton.textContent = currentUser ? (currentUser.name || currentUser.email).slice(0, 2).toUpperCase() : 'JD';
  profileButton.setAttribute('aria-label', currentUser ? 'Open account menu' : 'Sign in');
}
function openAdmin() {
  adminPanel.classList.remove('hidden');
  document.querySelector('main').classList.add('hidden');
  renderAdmin();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function closeAdmin() { adminPanel.classList.add('hidden'); document.querySelector('main').classList.remove('hidden'); }
function renderAdmin() {
  const pending = bookings.filter(booking => booking.status === 'pending').length;
  const confirmed = bookings.filter(booking => booking.status === 'confirmed').length;
  document.querySelector('#adminStats').innerHTML = `<div><span>Pending review</span><strong>${pending}</strong></div><div><span>Confirmed</span><strong>${confirmed}</strong></div><div><span>Total records</span><strong>${bookings.length}</strong></div>`;
  document.querySelector('#adminBookingRows').innerHTML = bookings.length ? bookings.slice().sort((a, b) => b.createdAt - a.createdAt).map(booking => { const court = COURTS.find(item => item.id === booking.courtId); return `<tr><td><strong>${booking.fullName || 'Demo customer'}</strong><small>${booking.phone || 'No phone'}</small></td><td>${court?.name || `Court ${booking.courtId}`}<small>${String(booking.hour).padStart(2, '0')}:00 - ${String(booking.hour + 1).padStart(2, '0')}:00</small></td><td>${dateLabel(new Date(`${booking.date}T12:00:00`), { month: 'short', day: 'numeric', year: 'numeric' })}</td><td><small>${booking.reference || 'Proof uploaded'}</small></td><td><span class="status-pill ${booking.status}">${booking.status}</span></td><td>${booking.status === 'pending' ? `<button class="table-action confirm" data-action="confirmed" data-id="${booking.id}">Confirm</button><button class="table-action cancel" data-action="cancelled" data-id="${booking.id}">Cancel</button>` : '<span class="muted-action">No action</span>'}</td></tr>`; }).join('') : '<tr><td colspan="6" class="table-empty">No booking records yet.</td></tr>';
  document.querySelectorAll('.table-action').forEach(button => button.addEventListener('click', () => { const booking = bookings.find(item => item.id === button.dataset.id); if (booking) { booking.status = button.dataset.action; saveBookings(); renderAdmin(); renderCourts(); renderMyBookings(); showToast(`Booking ${button.dataset.action}.`); } }));
}
function saveBookings() { localStorage.setItem('rally-bookings', JSON.stringify(bookings)); }
function showToast(message) { toast.querySelector('span').textContent = message; toast.classList.remove('hidden'); setTimeout(() => toast.classList.add('hidden'), 4000); }

function renderMyBookings() {
  const active = bookings.filter(booking => ['pending', 'confirmed'].includes(booking.status)).sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!active) { bookingCard.innerHTML = '<div class="empty-state"><div class="empty-icon"><i data-lucide="calendar-days"></i></div><div><strong>No active bookings</strong><p>Your upcoming court time will appear here.</p></div></div>'; window.lucide?.createIcons(); return; }
  const court = COURTS.find(item => item.id === active.courtId);
  const statusLabel = active.status === 'pending' ? 'PAYMENT PENDING' : 'CONFIRMED';
  bookingCard.innerHTML = `<div class="booking-item"><div><span class="court-badge">${statusLabel}</span><h3>${court.name} · ${String(active.hour).padStart(2, '0')}:00</h3><p>${dateLabel(new Date(`${active.date}T12:00:00`), { weekday: 'long', month: 'short', day: 'numeric' })}</p></div><strong>₱ 350</strong></div>`;
}

continueButton.addEventListener('click', openCheckout);
profileButton.addEventListener('click', () => { if (!currentUser) { showAuthMode(false); authModal.classList.remove('hidden'); } else if (currentUser.role === 'admin') openAdmin(); else showToast(`Signed in as ${currentUser.name || currentUser.email}.`); });
document.querySelector('#closeModal').addEventListener('click', closeCheckout);
document.querySelector('#closeAuth').addEventListener('click', closeAuth);
document.querySelector('#toggleAuth').addEventListener('click', () => showAuthMode(!isSignUp));
document.querySelector('#closeAdmin').addEventListener('click', closeAdmin);
checkoutModal.addEventListener('click', event => { if (event.target === checkoutModal) closeCheckout(); });
authModal.addEventListener('click', event => { if (event.target === authModal) closeAuth(); });
authForm.addEventListener('submit', event => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const email = formData.get('email').toLowerCase();
  const password = formData.get('password');
  if (isSignUp) {
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
  if (selection) showCheckout();
});
document.querySelector('#checkoutForm').addEventListener('submit', event => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  bookings.push({ id: crypto.randomUUID(), ...selection, date: selectedDate, fullName: formData.get('fullName'), phone: formData.get('phone'), reference: formData.get('reference'), status: 'pending', createdAt: Date.now() });
  saveBookings(); renderCourts(); renderMyBookings(); selection = null; renderSummary(); closeCheckout(); event.currentTarget.reset(); showToast('Booking held. Upload received for review.');
});

renderDates();
renderCourts();
renderSummary();
renderMyBookings();
updateProfile();
window.lucide?.createIcons();
