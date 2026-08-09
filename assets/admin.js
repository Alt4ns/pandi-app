import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, OAuthProvider, onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { collection, doc, getFirestore, onSnapshot, orderBy, query, serverTimestamp, writeBatch } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { adminEmail, firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const login = document.querySelector("#admin-login");
const panel = document.querySelector("#admin-app");
const loginStatus = document.querySelector("#login-status");
const list = document.querySelector("#ticket-list");
const detail = document.querySelector("#ticket-detail");
let tickets = [];
let activeFilter = "all";
let activeTicketId = null;
let stopTickets = null;
let stopMessages = null;

const escapeHtml = (value = "") => { const el = document.createElement("div"); el.textContent = value; return el.innerHTML; };
const toDate = (value) => value?.toDate ? value.toDate() : new Date();
const formatDate = (value) => new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(toDate(value));
const codeFor = (id) => `PND-${id.slice(0, 8).toUpperCase()}`;
const statusLabel = (status) => ({ new: "Yeni", in_progress: "İnceleniyor", resolved: "Çözüldü" }[status] || status);

async function signIn(action) {
  loginStatus.textContent = "Giriş yapılıyor…";
  try { await action(); }
  catch (error) { console.error(error); loginStatus.textContent = "Giriş başarısız. Sağlayıcının etkin ve hesabın yetkili olduğundan emin ol."; }
}

document.querySelector("#admin-google").addEventListener("click", () => signIn(() => signInWithPopup(auth, new GoogleAuthProvider())));
document.querySelector("#admin-apple").addEventListener("click", () => signIn(() => signInWithPopup(auth, new OAuthProvider("apple.com"))));
document.querySelector("#admin-email-login").addEventListener("click", () => signIn(() => signInWithEmailAndPassword(auth, document.querySelector("#admin-email").value.trim(), document.querySelector("#admin-password").value)));
document.querySelector("#admin-logout").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  const allowed = user?.email?.toLowerCase() === adminEmail && user.emailVerified;
  if (user && !allowed) { loginStatus.textContent = "Bu hesap yönetici yetkisine sahip değil veya e-postası doğrulanmamış."; await signOut(auth); return; }
  login.hidden = !!allowed;
  panel.hidden = !allowed;
  if (!allowed) { stopTickets?.(); stopMessages?.(); return; }
  document.querySelector("#admin-user-email").textContent = user.email;
  document.querySelector("#admin-avatar").textContent = user.email[0].toUpperCase();
  listenTickets();
});

function listenTickets() {
  list.innerHTML = '<div class="empty">Talepler yükleniyor…</div>';
  stopTickets?.();
  stopTickets = onSnapshot(query(collection(db, "DestekTalepleri"), orderBy("createdAt", "desc")), (snapshot) => {
    tickets = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    render();
    if (activeTicketId && !tickets.some(ticket => ticket.id === activeTicketId)) openTicket(null);
  }, (error) => { console.error(error); list.innerHTML = '<div class="empty">Talepler yüklenemedi. Firebase kurallarını kontrol et.</div>'; });
}

function render() {
  document.querySelector("#stat-total").textContent = tickets.length;
  document.querySelector("#stat-new").textContent = tickets.filter(x => x.status === "new").length;
  document.querySelector("#stat-progress").textContent = tickets.filter(x => x.status === "in_progress").length;
  document.querySelector("#stat-done").textContent = tickets.filter(x => x.status === "resolved").length;
  const term = document.querySelector("#ticket-search").value.trim().toLowerCase();
  const shown = tickets.filter(x => (activeFilter === "all" || x.status === activeFilter) && `${x.id} ${x.name} ${x.email} ${x.category} ${x.message} ${x.lastMessage || ""}`.toLowerCase().includes(term));
  if (!shown.length) { list.innerHTML = '<div class="empty">Bu görünümde destek talebi bulunmuyor.</div>'; return; }
  list.innerHTML = shown.map(ticket => `<article class="ticket ${ticket.id === activeTicketId ? "active" : ""}" data-id="${ticket.id}"><div class="ticket-code"><strong>${codeFor(ticket.id)}</strong><span class="badge ${ticket.status}">${statusLabel(ticket.status)}</span><small>${formatDate(ticket.updatedAt || ticket.createdAt)}</small></div><div class="ticket-main"><small>${escapeHtml(ticket.category)}</small><strong>${escapeHtml(ticket.name)} · ${escapeHtml(ticket.email)}</strong><p>${escapeHtml(ticket.lastMessage || ticket.message)}</p></div></article>`).join("");
  list.querySelectorAll("[data-id]").forEach(card => card.addEventListener("click", () => openTicket(card.dataset.id)));
}

function openTicket(id) {
  activeTicketId = id;
  stopMessages?.();
  render();
  if (!id) { detail.innerHTML = '<div class="detail-empty"><span>♡</span><strong>Bir destek talebi seç</strong><p>Konuşma ve yanıt alanı burada açılır.</p></div>'; return; }
  renderDetailHeader();
  const ticket = tickets.find(item => item.id === id);
  const messages = detail.querySelector("#admin-messages");
  messages.innerHTML = '<div class="empty">Konuşma yükleniyor…</div>';
  stopMessages = onSnapshot(query(collection(db, "DestekTalepleri", id, "Mesajlar"), orderBy("createdAt", "asc")), (snapshot) => {
    const items = snapshot.docs.map(item => item.data());
    renderMessages(items.length ? items : [{ senderRole: "user", text: ticket.message, createdAt: ticket.createdAt }]);
  }, (error) => { console.error(error); messages.innerHTML = '<div class="empty">Mesajlar yüklenemedi.</div>'; });
}

function renderDetailHeader() {
  const ticket = tickets.find(item => item.id === activeTicketId);
  if (!ticket) return;
  detail.innerHTML = `<header class="detail-header"><div><small>${codeFor(ticket.id)}</small><h2>${escapeHtml(ticket.category)}</h2><p>${escapeHtml(ticket.name)} · ${escapeHtml(ticket.email)}</p></div><select id="detail-status"><option value="new" ${ticket.status === "new" ? "selected" : ""}>Yeni</option><option value="in_progress" ${ticket.status === "in_progress" ? "selected" : ""}>İnceleniyor</option><option value="resolved" ${ticket.status === "resolved" ? "selected" : ""}>Çözüldü</option></select></header><div id="admin-messages" class="admin-messages"></div><form id="admin-reply" class="admin-reply"><textarea name="message" minlength="2" maxlength="3000" required placeholder="Kullanıcıya yanıt yaz…"></textarea><button type="submit">Yanıtla ↑</button><small class="email-note">Yanıt konuşmaya eklenir ve e-posta bildirim kuyruğuna gönderilir.</small><p id="admin-reply-status" class="status" role="status"></p></form>`;
  detail.querySelector("#detail-status").addEventListener("change", changeStatus);
  detail.querySelector("#admin-reply").addEventListener("submit", sendReply);
}

function renderMessages(messages) {
  const container = detail.querySelector("#admin-messages");
  if (!container) return;
  container.innerHTML = messages.map(message => `<article class="admin-message ${message.senderRole === "admin" ? "admin" : "user"}"><small>${message.senderRole === "admin" ? "PANDİ DESTEK" : "KULLANICI"}</small><p>${escapeHtml(message.text)}</p><time>${formatDate(message.createdAt)}</time></article>`).join("");
  container.scrollTop = container.scrollHeight;
}

async function changeStatus(event) {
  const ticket = tickets.find(item => item.id === activeTicketId);
  if (!ticket) return;
  event.target.disabled = true;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "DestekTalepleri", ticket.id), { status: event.target.value, updatedAt: serverTimestamp() });
    await batch.commit();
  } catch (error) { console.error(error); event.target.value = ticket.status; }
  finally { event.target.disabled = false; }
}

async function sendReply(event) {
  event.preventDefault();
  const ticket = tickets.find(item => item.id === activeTicketId);
  if (!ticket || !event.currentTarget.reportValidity()) return;
  const form = event.currentTarget;
  const button = form.querySelector("button");
  const status = form.querySelector("#admin-reply-status");
  const text = form.elements.message.value.trim();
  button.disabled = true;
  status.textContent = "Yanıt kaydediliyor…";
  try {
    const ticketRef = doc(db, "DestekTalepleri", ticket.id);
    const messageRef = doc(collection(ticketRef, "Mesajlar"));
    const mailRef = doc(collection(db, "mail"));
    const subject = `Pandi Destek yanıtladı · ${codeFor(ticket.id)}`;
    const batch = writeBatch(db);
    batch.set(messageRef, { senderId: auth.currentUser.uid, senderRole: "admin", text, createdAt: serverTimestamp() });
    batch.update(ticketRef, { status: "in_progress", updatedAt: serverTimestamp(), lastMessage: text.slice(0, 200), lastMessageAt: serverTimestamp(), lastSender: "admin" });
    batch.set(mailRef, { ticketId: ticket.id, to: ticket.email, createdAt: serverTimestamp(), message: { subject, text: `Merhaba ${ticket.name},\n\nPandi Destek yanıtladı:\n\n${text}\n\nTalebini görüntüle: https://alt4ns.github.io/pandi-app/support.html`, html: `<p>Merhaba ${escapeHtml(ticket.name)},</p><p><strong>Pandi Destek yanıtladı:</strong></p><p>${escapeHtml(text).replace(/\n/g, "<br>")}</p><p><a href="https://alt4ns.github.io/pandi-app/support.html">Destek talebini görüntüle</a></p>` } });
    await batch.commit();
    form.reset();
    status.style.color = "#177a53";
    status.textContent = "Yanıt kaydedildi ve e-posta kuyruğuna eklendi.";
    setTimeout(() => { status.textContent = ""; }, 3500);
  } catch (error) { console.error(error); status.style.color = "#b62f24"; status.textContent = "Yanıt kaydedilemedi. Kuralları ve e-posta yapılandırmasını kontrol et."; }
  finally { button.disabled = false; }
}

document.querySelector("#refresh").addEventListener("click", listenTickets);
document.querySelector("#ticket-search").addEventListener("input", render);
document.querySelectorAll("[data-filter]").forEach(button => button.addEventListener("click", () => { document.querySelectorAll("[data-filter]").forEach(x => x.classList.remove("active")); button.classList.add("active"); activeFilter = button.dataset.filter; render(); }));
