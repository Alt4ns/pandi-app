import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, OAuthProvider, onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { collection, doc, getDocs, getFirestore, orderBy, query, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { adminEmail, firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const login = document.querySelector("#admin-login");
const panel = document.querySelector("#admin-app");
const loginStatus = document.querySelector("#login-status");
const list = document.querySelector("#ticket-list");
let tickets = [];
let activeFilter = "all";

const signIn = async (action) => { loginStatus.textContent = "Giriş yapılıyor…"; try { await action(); } catch (error) { console.error(error); loginStatus.textContent = "Giriş başarısız. Sağlayıcının etkin ve hesabın yetkili olduğundan emin ol."; } };
document.querySelector("#admin-google").addEventListener("click", () => signIn(() => signInWithPopup(auth, new GoogleAuthProvider())));
document.querySelector("#admin-apple").addEventListener("click", () => signIn(() => signInWithPopup(auth, new OAuthProvider("apple.com"))));
document.querySelector("#admin-email-login").addEventListener("click", () => signIn(() => signInWithEmailAndPassword(auth, document.querySelector("#admin-email").value.trim(), document.querySelector("#admin-password").value)));
document.querySelector("#admin-logout").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  const allowed = user?.email?.toLowerCase() === adminEmail && user.emailVerified;
  if (user && !allowed) { loginStatus.textContent = "Bu hesap yönetici yetkisine sahip değil veya e-postası doğrulanmamış."; await signOut(auth); return; }
  login.hidden = !!allowed; panel.hidden = !allowed;
  if (allowed) { document.querySelector("#admin-user-email").textContent = user.email; document.querySelector("#admin-avatar").textContent = user.email[0].toUpperCase(); await loadTickets(); }
});

async function loadTickets() {
  list.innerHTML = '<div class="empty">Talepler yükleniyor…</div>';
  try {
    const snapshot = await getDocs(query(collection(db, "DestekTalepleri"), orderBy("createdAt", "desc")));
    tickets = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    render();
  } catch (error) { console.error(error); list.innerHTML = '<div class="empty">Talepler yüklenemedi. Firebase kurallarını ve yönetici yetkisini kontrol et.</div>'; }
}

function render() {
  document.querySelector("#stat-total").textContent = tickets.length;
  document.querySelector("#stat-new").textContent = tickets.filter(x => x.status === "new").length;
  document.querySelector("#stat-progress").textContent = tickets.filter(x => x.status === "in_progress").length;
  document.querySelector("#stat-done").textContent = tickets.filter(x => x.status === "resolved").length;
  const term = document.querySelector("#ticket-search").value.trim().toLowerCase();
  const shown = tickets.filter(x => (activeFilter === "all" || x.status === activeFilter) && `${x.id} ${x.name} ${x.email} ${x.category} ${x.message}`.toLowerCase().includes(term));
  if (!shown.length) { list.innerHTML = '<div class="empty">Bu görünümde destek talebi bulunmuyor.</div>'; return; }
  list.innerHTML = shown.map(ticket => {
    const date = ticket.createdAt?.toDate ? ticket.createdAt.toDate().toLocaleString("tr-TR") : "Yeni oluşturuldu";
    const statusLabel = {new:"Yeni",in_progress:"İnceleniyor",resolved:"Çözüldü"}[ticket.status] || ticket.status;
    return `<article class="ticket"><div class="ticket-code"><small>TAKİP NO</small><strong>PND-${ticket.id.slice(0,8).toUpperCase()}</strong><span class="badge ${ticket.status}">${statusLabel}</span><small>${date}</small></div><div class="ticket-main"><small>${escapeHtml(ticket.category)}</small><strong>${escapeHtml(ticket.name)} · ${escapeHtml(ticket.email)}</strong><p>${escapeHtml(ticket.message)}</p></div><div class="ticket-actions"><select data-id="${ticket.id}"><option value="new" ${ticket.status==="new"?"selected":""}>Yeni</option><option value="in_progress" ${ticket.status==="in_progress"?"selected":""}>İnceleniyor</option><option value="resolved" ${ticket.status==="resolved"?"selected":""}>Çözüldü</option></select><a href="mailto:${encodeURIComponent(ticket.email)}?subject=${encodeURIComponent(`Pandi Destek · PND-${ticket.id.slice(0,8).toUpperCase()}`)}">E-posta ile yanıtla ↗</a></div></article>`;
  }).join("");
  list.querySelectorAll("select[data-id]").forEach(select => select.addEventListener("change", async () => { select.disabled = true; await updateDoc(doc(db,"DestekTalepleri",select.dataset.id),{status:select.value,updatedAt:serverTimestamp()}); const ticket=tickets.find(x=>x.id===select.dataset.id); ticket.status=select.value; render(); }));
}

function escapeHtml(value="") { const el=document.createElement("div"); el.textContent=value; return el.innerHTML; }
document.querySelector("#refresh").addEventListener("click", loadTickets);
document.querySelector("#ticket-search").addEventListener("input", render);
document.querySelectorAll("[data-filter]").forEach(button => button.addEventListener("click", () => { document.querySelectorAll("[data-filter]").forEach(x=>x.classList.remove("active")); button.classList.add("active"); activeFilter=button.dataset.filter; render(); }));
