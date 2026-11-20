import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { createUserWithEmailAndPassword, getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { collection, doc, getDoc, getDocs, getFirestore, query, runTransaction, serverTimestamp, setDoc, where } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { deleteObject, getDownloadURL, getStorage, ref, uploadBytes } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';
import Panzoom from 'https://esm.sh/@panzoom/panzoom@4.5.1';
import { FIREBASE_CONFIG } from './config.js';

const FIREBASE_CONFIGURED = !Object.values(FIREBASE_CONFIG).some(value => value.startsWith('your-'));
const firebaseApp = FIREBASE_CONFIGURED ? initializeApp(FIREBASE_CONFIG) : null;
const firebaseAuth = firebaseApp ? getAuth(firebaseApp) : null;
const firestore = firebaseApp ? getFirestore(firebaseApp) : null;
const firebaseStorage = firebaseApp ? getStorage(firebaseApp) : null;
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
let occupiedSlots = [];
const invalidReceiptPaths = new Set();
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
const receiptViewport = document.querySelector('#receiptViewport');
const receiptZoomIn = document.querySelector('#receiptZoomIn');
const receiptZoomOut = document.querySelector('#receiptZoomOut');
const receiptZoomReset = document.querySelector('#receiptZoomReset');
const checkoutReceiptPreview = document.querySelector('#checkoutReceiptPreview');
const receiptPreviewShell = document.querySelector('#receiptPreviewShell');
const clearReceiptButton = document.querySelector('#clearReceiptButton');
const demoHint = document.querySelector('#demoHint');
const receiptPanzoom = Panzoom(receiptPreviewImage, { maxScale: 5, minScale: 1, step: 0.35, contain: 'outside' });
receiptViewport.addEventListener('wheel', receiptPanzoom.zoomWithWheel);

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
  const backendUnavailable = occupiedSlots.some(slot => slot.date === selectedDate && slot.courtId === courtId && slot.hour === hour);
  const localUnavailable = bookings.some(booking => booking.date === selectedDate && booking.courtId === courtId && booking.hour === hour && ['pending', 'confirmed'].includes(booking.status));
  return (backendUnavailable || localUnavailable) && !selectedKeys.has(slotKey(courtId, hour));
}

function normalizeBooking(booking) {
  const createdAt = booking.createdAt?.toMillis?.() ?? booking.createdAt ?? Date.now();
  return { ...booking, courtId: booking.courtId, hour: booking.hour, date: booking.date, createdAt, fullName: booking.fullName, phone: booking.phone, reference: booking.reference };
}

async function attachReceiptUrls(bookingList) {
  if (!FIREBASE_CONFIGURED) return bookingList;
  return Promise.all(bookingList.map(async booking => {
    const canViewReceipt = currentUser?.role === 'admin' || booking.user_id === currentUser?.id;
    if (!canViewReceipt || !booking.payment_proof_path || booking.proofDataUrl || invalidReceiptPaths.has(booking.payment_proof_path)) return booking;
    try {
      return { ...booking, proofDataUrl: await getDownloadURL(ref(firebaseStorage, booking.payment_proof_path)) };
    } catch {
      invalidReceiptPaths.add(booking.payment_proof_path);
      return booking;
    }
  }));
}

async function loadBookings() {
  if (!FIREBASE_CONFIGURED) return;
  try {
    const slotSnapshot = await getDocs(collection(firestore, 'occupiedSlots'));
    occupiedSlots = slotSnapshot.docs.map(item => item.data());
    if (!currentUser) {
      bookings = [];
      renderCourts();
      renderMyBookings();
      return;
    }
    const bookingsRef = collection(firestore, 'bookings');
    const bookingQuery = currentUser.role === 'admin'
      ? query(bookingsRef)
      : query(bookingsRef, where('user_id', '==', currentUser.id));
    const snapshot = await getDocs(bookingQuery);
    bookings = await attachReceiptUrls(snapshot.docs.map(item => normalizeBooking({ id: item.id, ...item.data() })));
    renderCourts(); renderMyBookings();
    if (currentUser.role === 'admin' && !adminPanel.classList.contains('hidden')) renderAdmin();
  } catch (error) {
    showToast(error.message || 'Unable to load bookings.');
  }
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
  if (FIREBASE_CONFIGURED) {
    signOut(firebaseAuth).catch(error => showToast(error.message));
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
  receiptPanzoom.reset({ animate: false });
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
      if (FIREBASE_CONFIGURED) {
        try {
          await runTransaction(firestore, async transaction => {
            transaction.update(doc(firestore, 'bookings', booking.id), { status: button.dataset.action, ...(button.dataset.action === 'confirmed' ? { confirmedAt: serverTimestamp() } : {}) });
            if (button.dataset.action === 'cancelled') {
              transaction.delete(doc(firestore, 'occupiedSlots', `${booking.date}_${booking.courtId}_${booking.hour}`));
            }
          });
          await loadBookings();
        } catch (error) {
          handleBookingError(error);
          return;
        }
      } else { booking.status = button.dataset.action; saveBookings(); renderAdmin(); renderCourts(); renderMyBookings(); }
      showToast(`Booking ${button.dataset.action}.`);
    });
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
  if (normalized.includes('user already registered') || error?.code === 'auth/email-already-in-use') {
    showToast('This email is already registered. Please sign in instead.');
    return;
  }
  showToast(message);
}

function handleBookingError(error) {
  const message = error?.message || 'Unable to submit booking.';
  if (message.toLowerCase().includes('permission') || error?.code === 'permission-denied') {
    showToast('Firebase blocked this action. Check the Firestore and Storage security rules.');
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
  const currentUserId = currentUser?.id || currentUser?.email;
  const ownBookings = currentUser?.role === 'admin' ? bookings : bookings.filter(booking => booking.user_id === currentUserId);
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
receiptZoomIn.addEventListener('click', () => receiptPanzoom.zoomIn());
receiptZoomOut.addEventListener('click', () => receiptPanzoom.zoomOut());
receiptZoomReset.addEventListener('click', () => receiptPanzoom.reset());
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
  if (FIREBASE_CONFIGURED) {
    try {
      const credential = isSignUp
        ? await createUserWithEmailAndPassword(firebaseAuth, email, password)
        : await signInWithEmailAndPassword(firebaseAuth, email, password);
      const profileRef = doc(firestore, 'profiles', credential.user.uid);
      if (isSignUp) {
        await setDoc(profileRef, { name: email.split('@')[0], phone: '', role: 'customer' });
      }
      const profile = await getDoc(profileRef);
      currentUser = { id: credential.user.uid, uid: credential.user.uid, email: credential.user.email, name: profile.data()?.name || email.split('@')[0], role: profile.data()?.role || 'customer' };
    } catch (error) {
      handleAuthError(error);
      return;
    }
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
  if (!currentUser || (FIREBASE_CONFIGURED && !currentUser.id)) {
    showToast('Please sign in again before submitting a booking.');
    return;
  }
  if (FIREBASE_CONFIGURED) {
    if (!firebaseAuth.currentUser) {
      currentUser = null;
      localStorage.removeItem('rally-user');
      updateProfile();
      showToast('Your session expired. Please sign in again before submitting.');
      closeCheckout();
      showAuthMode(false);
      authModal.classList.remove('hidden');
      return;
    }
    currentUser.id = firebaseAuth.currentUser.uid;
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
  const paymentProofPath = `${currentUser.id || currentUser.email}/${crypto.randomUUID()}-${proof.name}`;
  if (FIREBASE_CONFIGURED) {
    const receiptRef = ref(firebaseStorage, paymentProofPath);
    try {
      await setDoc(doc(firestore, 'profiles', currentUser.id), { name: fullName, phone }, { merge: true });
      await uploadBytes(receiptRef, proof, { contentType: proof.type });
      await runTransaction(firestore, async transaction => {
        const bookingRefs = selection.map(() => doc(collection(firestore, 'bookings')));
        const occupiedSlotRefs = selection.map(slot => doc(firestore, 'occupiedSlots', `${selectedDate}_${slot.courtId}_${slot.hour}`));
        selection.forEach((slot, index) => transaction.set(bookingRefs[index], {
          user_id: currentUser.id, courtId: slot.courtId, date: selectedDate, hour: slot.hour,
          amount: BOOKING_RATE, status: 'pending', reference, payment_proof_path: paymentProofPath,
          fullName, phone, createdAt: serverTimestamp()
        }));
        selection.forEach((slot, index) => transaction.set(occupiedSlotRefs[index], {
          date: selectedDate, courtId: slot.courtId, hour: slot.hour, bookingId: bookingRefs[index].id
        }));
      });
      await loadBookings();
    } catch (error) {
      await deleteObject(receiptRef).catch(() => {});
      handleBookingError(error);
      return;
    }
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
  if (!FIREBASE_CONFIGURED) return;
  onAuthStateChanged(firebaseAuth, async user => {
    if (user) {
      const profile = await getDoc(doc(firestore, 'profiles', user.uid));
      currentUser = { id: user.uid, uid: user.uid, email: user.email, name: profile.data()?.name || user.email, role: profile.data()?.role || 'customer' };
      localStorage.setItem('rally-user', JSON.stringify(currentUser));
      await loadBookings();
    } else {
      currentUser = null;
      localStorage.removeItem('rally-user');
      bookings = [];
      await loadBookings();
    }
    updateProfile();
  });
}

initializeAuth();
