const HOURS = Array.from({ length: 15 }, (_, index) => index + 7);
const COURTS = [
  { id: 1, name: 'Court 1', detail: 'Outdoor · acrylic surface' },
  { id: 2, name: 'Court 2', detail: 'Outdoor · acrylic surface' }
];
const today = new Date();
let selectedDate = formatDate(today);
let selection = null;
let holdInterval;

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
document.querySelector('#closeModal').addEventListener('click', closeCheckout);
checkoutModal.addEventListener('click', event => { if (event.target === checkoutModal) closeCheckout(); });
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
window.lucide?.createIcons();
