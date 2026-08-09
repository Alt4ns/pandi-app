import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, OAuthProvider, createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { collection, doc, getFirestore, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where, writeBatch } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const authBox = document.querySelector("#support-auth");
const supportApp = document.querySelector("#support-app");
const authStatus = document.querySelector("#auth-status");
const ticketList = document.querySelector("#ticket-list");
const newTicketForm = document.querySelector("#new-ticket-form");
const conversation = document.querySelector("#conversation");
const conversationEmpty = document.querySelector("#conversation-empty");
const messageList = document.querySelector("#message-list");
const replyForm = document.querySelector("#reply-form");
let currentUser = null;
let tickets = [];
let activeTicketId = null;
let pendingTicketId = null;
let stopTickets = null;
let stopMessages = null;

const escapeHtml = (value = "") => { const el = document.createElement("div"); el.textContent = value; return el.innerHTML; };
const toDate = (value) => value?.toDate ? value.toDate() : new Date();
const formatDate = (value) => new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(toDate(value));
const statusLabel = (status) => ({ new: "Yeni", in_progress: "İnceleniyor", resolved: "Çözüldü" }[status] || "Yeni");
const codeFor = (id) => `PND-${id.slice(0, 8).toUpperCase()}`;

function authMessage(error) {
  const code = error?.code || "";
  if (code.includes("popup-closed")) return "Giriş penceresi kapatıldı.";
  if (code.includes("account-exists-with-different-credential")) return "Bu e-posta başka bir giriş yöntemiyle kayıtlı.";
  if (code.includes("email-already-in-use")) return "Bu e-posta ile zaten bir hesap var. Giriş yapmayı dene.";
  if (code.includes("invalid-credential")) return "E-posta veya şifre hatalı.";
  if (code.includes("weak-password")) return "Şifren en az 6 karakter olmalı.";
  return "Giriş tamamlanamadı. Lütfen tekrar dene.";
}

async function runAuth(action) {
  authStatus.className = "status";
  authStatus.textContent = "Güvenli giriş hazırlanıyor…";
  try { await action(); }
  catch (error) { console.error(error); authStatus.className = "status error"; authStatus.textContent = authMessage(error); }
}

document.querySelector("#google-login").addEventListener("click", () => runAuth(() => signInWithPopup(auth, new GoogleAuthProvider())));
document.querySelector("#apple-login").addEventListener("click", () => runAuth(() => signInWithPopup(auth, new OAuthProvider("apple.com"))));
document.querySelector("#email-login").addEventListener("click", () => runAuth(() => signInWithEmailAndPassword(auth, document.querySelector("#auth-email").value.trim(), document.querySelector("#auth-password").value)));
document.querySelector("#email-register").addEventListener("click", () => runAuth(async () => {
  const result = await createUserWithEmailAndPassword(auth, document.querySelector("#auth-email").value.trim(), document.querySelector("#auth-password").value);
  await updateProfile(result.user, { displayName: result.user.email.split("@")[0] });
}));
document.querySelector("#logout").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  authBox.hidden = !!user;
  supportApp.hidden = !user;
  if (!user) { stopTickets?.(); stopMessages?.(); return; }
  const label = user.displayName || user.email || "Pandi kullanıcısı";
  document.querySelector("#account-name").textContent = label;
  document.querySelector("#account-avatar").textContent = label.slice(0, 1).toUpperCase();
  newTicketForm.elements.name.value = user.displayName || "";
  authStatus.textContent = "";
  listenTickets();
});

function listenTickets() {
  stopTickets?.();
  stopTickets = onSnapshot(query(collection(db, "DestekTalepleri"), where("uid", "==", currentUser.uid)), (snapshot) => {
    tickets = snapshot.docs.map(item => ({ id: item.id, ...item.data() })).sort((a, b) => toDate(b.updatedAt || b.createdAt) - toDate(a.updatedAt || a.createdAt));
    renderTickets();
    if (pendingTicketId && tickets.some(ticket => ticket.id === pendingTicketId)) {
      const ticketId = pendingTicketId;
      pendingTicketId = null;
      selectTicket(ticketId);
      return;
    }
    if (activeTicketId && !tickets.some(ticket => ticket.id === activeTicketId)) selectTicket(null);
  }, (error) => { console.error(error); ticketList.innerHTML = '<p class="empty-state">Talepler yüklenemedi. Lütfen tekrar dene.</p>'; });
}

function renderTickets() {
  document.querySelector("#ticket-count").textContent = `${tickets.length} talep`;
  if (!tickets.length) { ticketList.innerHTML = '<p class="empty-state">Henüz destek talebin yok.</p>'; return; }
  ticketList.innerHTML = tickets.map(ticket => `<button class="ticket-row ${ticket.id === activeTicketId ? "active" : ""}" data-id="${ticket.id}"><span><b>${codeFor(ticket.id)}</b><i class="ticket-status ${ticket.status}">${statusLabel(ticket.status)}</i></span><strong>${escapeHtml(ticket.category)}</strong><p>${escapeHtml(ticket.lastMessage || ticket.message || "")}</p></button>`).join("");
  ticketList.querySelectorAll("[data-id]").forEach(button => button.addEventListener("click", () => selectTicket(button.dataset.id)));
}

function selectTicket(id) {
  activeTicketId = id;
  stopMessages?.();
  renderTickets();
  if (!id) { conversation.hidden = true; conversationEmpty.hidden = false; return; }
  const ticket = tickets.find(item => item.id === id);
  if (!ticket) return;
  newTicketForm.hidden = true;
  conversationEmpty.hidden = true;
  conversation.hidden = false;
  document.querySelector("#conversation-code").textContent = codeFor(id);
  document.querySelector("#conversation-title").textContent = ticket.category;
  document.querySelector("#conversation-meta").textContent = `${ticket.name} · ${formatDate(ticket.createdAt)}`;
  const badge = document.querySelector("#conversation-status");
  badge.className = `ticket-status ${ticket.status}`;
  badge.textContent = statusLabel(ticket.status);
  messageList.innerHTML = '<p class="empty-state">Konuşma yükleniyor…</p>';
  stopMessages = onSnapshot(query(collection(db, "DestekTalepleri", id, "Mesajlar"), orderBy("createdAt", "asc")), (snapshot) => {
    const messages = snapshot.docs.map(item => item.data());
    renderMessages(messages.length ? messages : [{ senderRole: "user", text: ticket.message, createdAt: ticket.createdAt }]);
  }, (error) => { console.error(error); messageList.innerHTML = '<p class="empty-state">Mesajlar yüklenemedi.</p>'; });
}

function renderMessages(messages) {
  messageList.innerHTML = messages.map(message => `<article class="message ${message.senderRole === "admin" ? "admin" : "user"}"><small>${message.senderRole === "admin" ? "PANDİ DESTEK" : "SEN"}</small><p>${escapeHtml(message.text)}</p><time>${formatDate(message.createdAt)}</time></article>`).join("");
  messageList.scrollTop = messageList.scrollHeight;
}

document.querySelector("#new-ticket-button").addEventListener("click", () => { conversation.hidden = true; conversationEmpty.hidden = true; newTicketForm.hidden = false; });
document.querySelector("#close-new-ticket").addEventListener("click", () => { newTicketForm.hidden = true; if (activeTicketId) conversation.hidden = false; else conversationEmpty.hidden = false; });

newTicketForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser || !newTicketForm.reportValidity() || newTicketForm.elements.website.value) return;
  const status = document.querySelector("#create-status");
  const button = newTicketForm.querySelector("button[type='submit']");
  const data = new FormData(newTicketForm);
  const text = data.get("message").trim();
  button.disabled = true;
  status.className = "status";
  status.textContent = "Talebin güvenli biçimde oluşturuluyor…";
  try {
    const ticketRef = doc(collection(db, "DestekTalepleri"));
    const messageRef = doc(collection(ticketRef, "Mesajlar"));
    const batch = writeBatch(db);
    batch.set(ticketRef, { uid: currentUser.uid, name: data.get("name").trim(), email: currentUser.email, category: data.get("category"), message: text, status: "new", source: "pandi-web", createdAt: serverTimestamp(), updatedAt: serverTimestamp(), lastMessage: text.slice(0, 200), lastMessageAt: serverTimestamp(), lastSender: "user" });
    batch.set(messageRef, { senderId: currentUser.uid, senderRole: "user", text, createdAt: serverTimestamp() });
    await batch.commit();
    status.className = "status success";
    status.textContent = `Talebin oluşturuldu: ${codeFor(ticketRef.id)}`;
    newTicketForm.elements.category.value = "";
    newTicketForm.elements.message.value = "";
    newTicketForm.elements.consent.checked = false;
    pendingTicketId = ticketRef.id;
    newTicketForm.hidden = true;
    conversationEmpty.hidden = false;
  } catch (error) { console.error(error); status.className = "status error"; status.textContent = "Talep oluşturulamadı. Lütfen tekrar dene."; }
  finally { button.disabled = false; }
});

replyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const ticket = tickets.find(item => item.id === activeTicketId);
  if (!currentUser || !ticket || !replyForm.reportValidity()) return;
  const status = document.querySelector("#reply-status");
  const button = replyForm.querySelector("button");
  const text = replyForm.elements.message.value.trim();
  button.disabled = true;
  status.className = "status";
  status.textContent = "Mesajın gönderiliyor…";
  try {
    const ticketRef = doc(db, "DestekTalepleri", ticket.id);
    const messageRef = doc(collection(ticketRef, "Mesajlar"));
    const batch = writeBatch(db);
    batch.set(messageRef, { senderId: currentUser.uid, senderRole: "user", text, createdAt: serverTimestamp() });
    batch.update(ticketRef, { updatedAt: serverTimestamp(), lastMessage: text.slice(0, 200), lastMessageAt: serverTimestamp(), lastSender: "user", status: ticket.status === "resolved" ? "in_progress" : ticket.status });
    await batch.commit();
    replyForm.reset();
    status.className = "status success";
    status.textContent = "Mesajın gönderildi.";
    setTimeout(() => { status.textContent = ""; }, 2500);
  } catch (error) { console.error(error); status.className = "status error"; status.textContent = "Mesaj gönderilemedi. Lütfen tekrar dene."; }
  finally { button.disabled = false; }
});
