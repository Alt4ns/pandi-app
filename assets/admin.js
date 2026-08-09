import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, OAuthProvider, onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { collection, deleteDoc, doc, getFirestore, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { adminEmail, firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const login = $("#admin-login");
const panel = $("#admin-app");
const loginStatus = $("#login-status");
const toast = $("#toast");
const state = { users: [], notifications: [], content: [], reports: [], tickets: [], view: "dashboard", reportFilter: "all", ticketFilter: "all", activeUser: null, activeContent: null, activeTicket: null, stops: [] };
let stopMessages = null;

const escapeHtml = (value = "") => { const el = document.createElement("div"); el.textContent = value ?? ""; return el.innerHTML; };
const toDate = (value) => value?.toDate ? value.toDate() : value ? new Date(value) : new Date(0);
const formatDate = (value) => value ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(toDate(value)) : "—";
const relativeDate = (value) => { const date = toDate(value); if (!date.getTime()) return "—"; const days = Math.floor((Date.now() - date) / 86400000); return days < 1 ? "Bugün" : days === 1 ? "Dün" : `${days} gün önce`; };
const codeFor = (id) => `PND-${id.slice(0, 8).toUpperCase()}`;
const statusLabel = (status) => ({ new: "Yeni", in_progress: "İnceleniyor", resolved: "Çözüldü" }[status] || status || "Yeni");
const roleOf = (user) => user.adminMi ? "admin" : (user.rol || "kullanici").toLowerCase();
const fullName = (user) => `${user.ad || ""} ${user.soyad || ""}`.trim() || user.email || "Pandi Üyesi";
const showToast = (message, type = "success") => { toast.textContent = message; toast.className = `show ${type}`; clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.className = "", 3200); };
const showError = (error, fallback = "İşlem tamamlanamadı.") => { console.error(error); showToast(error?.message || fallback, "error"); };

async function signIn(action) {
  loginStatus.textContent = "Giriş yapılıyor…";
  try { await action(); }
  catch (error) { console.error(error); loginStatus.textContent = "Giriş başarısız. Sağlayıcının etkin ve hesabın yetkili olduğundan emin ol."; }
}

$("#admin-google").addEventListener("click", () => signIn(() => signInWithPopup(auth, new GoogleAuthProvider())));
$("#admin-apple").addEventListener("click", () => signIn(() => signInWithPopup(auth, new OAuthProvider("apple.com"))));
$("#admin-email-login").addEventListener("click", () => signIn(() => signInWithEmailAndPassword(auth, $("#admin-email").value.trim(), $("#admin-password").value)));
$("#admin-password").addEventListener("keydown", event => { if (event.key === "Enter") $("#admin-email-login").click(); });
$("#admin-logout").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  const allowed = user?.email?.toLowerCase() === adminEmail && user.emailVerified;
  if (user && !allowed) { loginStatus.textContent = "Bu hesap yönetici yetkisine sahip değil veya e-postası doğrulanmamış."; await signOut(auth); return; }
  login.hidden = !!allowed; panel.hidden = !allowed;
  if (!allowed) { stopAll(); return; }
  $("#admin-user-email").textContent = user.email;
  $("#admin-avatar").textContent = user.email[0].toUpperCase();
  startListeners();
});

function stopAll() { state.stops.forEach(stop => stop?.()); state.stops = []; stopMessages?.(); }
function listen(q, handler, label) {
  const stop = onSnapshot(q, snapshot => handler(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))), error => { console.error(label, error); showToast(`${label} yüklenemedi. Firebase izinlerini kontrol et.`, "error"); });
  state.stops.push(stop);
}
function startListeners() {
  stopAll();
  listen(collection(db, "kullanicilar"), items => { state.users = items.sort((a,b) => toDate(b.olusturulmaTarihi) - toDate(a.olusturulmaTarihi)); renderUsers(); renderDashboard(); fillNotificationUsers(); }, "Kullanıcılar");
  listen(query(collection(db, "Bildirimler"), orderBy("olusturulmaTarihi", "desc"), limit(60)), items => { state.notifications = items; renderNotifications(); }, "Bildirimler");
  listen(collection(db, "PandiKulupIcerikleri"), items => { state.content = items.sort((a,b) => (a.sira || 0) - (b.sira || 0)); renderContent(); renderDashboard(); }, "Kulüp içerikleri");
  listen(query(collection(db, "Sikayetler"), orderBy("olusturulmaTarihi", "desc")), items => { state.reports = items; renderReports(); renderDashboard(); }, "Şikâyetler");
  listen(query(collection(db, "DestekTalepleri"), orderBy("createdAt", "desc")), items => { state.tickets = items; renderTickets(); renderDashboard(); }, "Destek talepleri");
}

function switchView(view) {
  state.view = view;
  $$("[data-view]").forEach(button => button.classList.toggle("active", button.dataset.view === view));
  $$("[data-panel]").forEach(section => section.classList.toggle("active", section.dataset.panel === view));
  $("#topbar-title").textContent = ({ dashboard:"Genel bakış", users:"Kullanıcılar", notifications:"Bildirim merkezi", content:"Kulüp içerikleri", moderation:"Şikâyetler", support:"Destek talepleri" })[view];
  panel.classList.remove("nav-open"); window.scrollTo({ top: 0, behavior: "smooth" });
}
$$('[data-view]').forEach(button => button.addEventListener("click", () => switchView(button.dataset.view)));
$$('[data-jump]').forEach(button => button.addEventListener("click", () => switchView(button.dataset.jump)));
$("#mobile-menu").addEventListener("click", () => panel.classList.toggle("nav-open"));
$("#refresh").addEventListener("click", () => { startListeners(); showToast("Veriler yenileniyor…"); });

function renderDashboard() {
  const weekAgo = Date.now() - 7 * 86400000;
  const newUsers = state.users.filter(user => toDate(user.olusturulmaTarihi).getTime() > weekAgo).length;
  const admins = state.users.filter(user => ["admin","yonetici","owner","sahip","kurucu"].includes(roleOf(user))).length;
  const activeContent = state.content.filter(item => item.aktif !== false).length;
  const openReports = state.reports.filter(item => (item.durum || "acik") !== "kapali").length;
  const pendingTickets = state.tickets.filter(item => item.status !== "resolved").length;
  [["dash-users",state.users.length],["dash-new-users",newUsers],["dash-content",activeContent],["dash-admins",admins],["dash-reports",openReports],["dash-tickets",pendingTickets],["nav-users",state.users.length],["nav-content",state.content.length],["nav-reports",openReports],["nav-tickets",pendingTickets]].forEach(([id,value]) => { const el = $(`#${id}`); if (el) el.textContent = value; });
  $("#today-summary").textContent = `${newUsers} yeni üye · ${openReports} açık şikâyet · ${pendingTickets} bekleyen destek`;
  $("#recent-users").innerHTML = state.users.slice(0,5).map(user => userRow(user, true)).join("") || '<div class="empty">Henüz kullanıcı yok.</div>';
  $$('[data-user-id]', $("#recent-users")).forEach(row => row.addEventListener("click", () => { state.activeUser = row.dataset.userId; renderUserDetail(); switchView("users"); }));
}

function userRow(user, compact = false) {
  const name = fullName(user); const role = roleOf(user);
  return `<button class="user-row ${compact ? "compact" : ""}" data-user-id="${user.id}"><span class="avatar">${escapeHtml(name[0]?.toUpperCase() || "P")}</span><span><b>${escapeHtml(name)}</b><small>${escapeHtml(user.email || "E-posta yok")}</small></span><em class="role ${role}">${escapeHtml(role)}</em><time>${relativeDate(user.olusturulmaTarihi)}</time><i>›</i></button>`;
}
function renderUsers() {
  const weekAgo = Date.now() - 7 * 86400000;
  const values = { "user-total":state.users.length, "user-week":state.users.filter(u => toDate(u.olusturulmaTarihi).getTime() > weekAgo).length, "user-admins":state.users.filter(u => roleOf(u) === "admin").length, "user-moderators":state.users.filter(u => roleOf(u) === "moderator").length };
  Object.entries(values).forEach(([id,value]) => { const el = $(`#${id}`); if (el) el.textContent = value; });
  const term = $("#user-search").value.trim().toLowerCase(); const filter = $("#user-role-filter").value;
  const shown = state.users.filter(user => (filter === "all" || roleOf(user) === filter) && `${user.id} ${fullName(user)} ${user.email || ""}`.toLowerCase().includes(term));
  $("#user-list").innerHTML = shown.map(user => userRow(user)).join("") || '<div class="empty">Kullanıcı bulunamadı.</div>';
  $$('[data-user-id]', $("#user-list")).forEach(row => row.addEventListener("click", () => { state.activeUser = row.dataset.userId; renderUserDetail(); }));
  if (state.activeUser && !state.users.some(user => user.id === state.activeUser)) state.activeUser = null;
}
function renderUserDetail() {
  const user = state.users.find(item => item.id === state.activeUser); if (!user) return;
  const role = roleOf(user); const name = fullName(user);
  $("#user-detail").innerHTML = `<div class="entity-head"><span class="avatar large">${escapeHtml(name[0]?.toUpperCase() || "P")}</span><div><small>KULLANICI HESABI</small><h2>${escapeHtml(name)}</h2><p>${escapeHtml(user.email || "E-posta yok")}</p></div></div><div class="info-grid"><div><small>KULLANICI UID</small><strong>${escapeHtml(user.id)}</strong></div><div><small>KAYIT TARİHİ</small><strong>${formatDate(user.olusturulmaTarihi)}</strong></div><div><small>ROL</small><strong>${escapeHtml(role)}</strong></div><div><small>HESAP KURULUMU</small><strong>${user.hesapKurulumuTamamlandi === false ? "Eksik" : "Tamamlandı"}</strong></div></div><button id="copy-user-id" class="secondary-button">UID’yi kopyala</button><form id="role-form" class="inline-form"><div><small>ROL VE YETKİ</small><h3>Kullanıcı rolünü değiştir</h3></div><select name="role"><option value="kullanici" ${role==="kullanici"?"selected":""}>Kullanıcı</option><option value="moderator" ${role==="moderator"?"selected":""}>Moderatör</option><option value="admin" ${role==="admin"?"selected":""}>Admin</option></select><button type="submit">Rolü güncelle</button><p class="status"></p></form><button id="notify-user" class="accent-button wide">Bu kullanıcıya bildirim gönder</button>`;
  $("#copy-user-id").addEventListener("click", async () => { await navigator.clipboard.writeText(user.id); showToast("Kullanıcı UID’si kopyalandı."); });
  $("#notify-user").addEventListener("click", () => { $("#notification-form").elements.target.value = "single"; $("#notification-user-wrap").hidden = false; $("#notification-user").value = user.id; switchView("notifications"); });
  $("#role-form").addEventListener("submit", async event => { event.preventDefault(); const nextRole = event.currentTarget.elements.role.value; const button = $("button[type=submit]", event.currentTarget); button.disabled = true; try { await updateDoc(doc(db,"kullanicilar",user.id), { rol:nextRole, adminMi:nextRole === "admin", rolGuncellenmeTarihi:serverTimestamp(), roluGuncelleyenKullaniciID:auth.currentUser.uid }); showToast("Kullanıcı rolü güncellendi."); } catch (error) { showError(error); } finally { button.disabled = false; } });
}
$("#user-search").addEventListener("input", renderUsers); $("#user-role-filter").addEventListener("change", renderUsers);

function fillNotificationUsers() { $("#notification-user").innerHTML = state.users.map(user => `<option value="${user.id}">${escapeHtml(fullName(user))} · ${escapeHtml(user.email || "")}</option>`).join(""); }
$("#notification-form").elements.target.addEventListener("change", event => { $("#notification-user-wrap").hidden = event.target.value !== "single"; });
$("#notification-form").addEventListener("submit", async event => {
  event.preventDefault(); const form = event.currentTarget; const status = $("#notification-status"); const button = $("button[type=submit]",form); const title = form.elements.title.value.trim(); const message = form.elements.message.value.trim(); const targets = form.elements.target.value === "all" ? state.users : state.users.filter(user => user.id === form.elements.userId.value);
  if (!targets.length) { status.textContent = "En az bir kullanıcı seç."; return; }
  button.disabled = true; status.textContent = `${targets.length} bildirim hazırlanıyor…`;
  try { for (let start=0; start<targets.length; start+=400) { const batch=writeBatch(db); targets.slice(start,start+400).forEach(user => { const ref=doc(collection(db,"Bildirimler")); const personalized=value=>value.replaceAll("{ad}",user.ad||"Pandi Üyesi").replaceAll("{adSoyad}",fullName(user)).replaceAll("{email}",user.email||""); const data={bildirimID:ref.id,kullaniciID:user.id,kullaniciAdi:fullName(user),baslik:personalized(title),mesaj:personalized(message),tur:form.elements.type.value,oncelik:form.elements.priority.value,hedefTipi:form.elements.target.value==="all"?"tumKullanicilar":"tekKullanici",okundu:false,gonderenKullaniciID:auth.currentUser.uid,olusturulmaTarihi:serverTimestamp()}; if(form.elements.action.value.trim()) data.aksiyonHedefi=form.elements.action.value.trim(); batch.set(ref,data); }); await batch.commit(); } form.reset(); $("#notification-user-wrap").hidden=true; status.textContent=""; showToast(`${targets.length} kullanıcı için bildirim oluşturuldu.`); } catch(error){ showError(error,"Bildirim gönderilemedi."); status.textContent="Bildirim gönderilemedi."; } finally { button.disabled=false; }
});
function renderNotifications(){ $("#notification-list").innerHTML = state.notifications.slice(0,20).map(item => `<article class="activity-row"><i class="${item.tur || "genel"}">◉</i><span><b>${escapeHtml(item.baslik || "Bildirim")}</b><small>${escapeHtml(item.kullaniciAdi || item.kullaniciID || "Kullanıcı")} · ${escapeHtml(item.mesaj || "")}</small></span><time>${relativeDate(item.olusturulmaTarihi)}</time></article>`).join("") || '<div class="empty">Henüz bildirim yok.</div>'; }

function renderContent(){ $("#content-list").innerHTML = state.content.map(item => `<button class="content-row ${state.activeContent===item.id?"active":""}" data-content-id="${item.id}"><span class="content-thumb">${item.imageURL?`<img src="${escapeHtml(item.imageURL)}" alt="">`:"▧"}</span><span><small>${escapeHtml(item.kategoriAdi||item.kategori||"Kulüp")}</small><b>${escapeHtml(item.baslik||"İsimsiz içerik")}</b><em>${item.aktif===false?"Taslak":"Yayında"} · Sıra ${item.sira??0}</em></span><i>›</i></button>`).join("") || '<div class="empty">Henüz Kulüp içeriği yok.</div>'; $$('[data-content-id]',$("#content-list")).forEach(row=>row.addEventListener("click",()=>{state.activeContent=row.dataset.contentId;renderContent();renderContentEditor();})); }
function renderContentEditor(item = state.content.find(x=>x.id===state.activeContent)) { const isNew=!item; const content=item||{id:"",aktif:true,sira:state.content.length+1}; $("#content-editor").innerHTML=`<form id="content-form" class="editor-form"><div class="section-title"><div><small>${isNew?"YENİ İÇERİK":"İÇERİĞİ DÜZENLE"}</small><h2>${isNew?"Kulüp kartı oluştur":escapeHtml(content.baslik||"İçerik")}</h2></div><span class="live-pill ${content.aktif===false?"draft":""}">${content.aktif===false?"TASLAK":"YAYINDA"}</span></div><label>Belge kimliği<input name="id" required ${isNew?"":"readonly"} value="${escapeHtml(content.id)}" placeholder="ornek-icerik"></label><label>Başlık<input name="title" required maxlength="120" value="${escapeHtml(content.baslik||"")}"></label><label>Kısa açıklama<textarea name="summary" maxlength="300">${escapeHtml(content.kisaAciklama||"")}</textarea></label><label>Detay metni<textarea class="tall" name="detail" maxlength="8000">${escapeHtml(content.detayMetni||"")}</textarea></label><div class="form-row"><label>Kategori<input name="category" value="${escapeHtml(content.kategori||"iyiYasam")}"></label><label>Kategori adı<input name="categoryTitle" value="${escapeHtml(content.kategoriAdi||"İyi Yaşam")}"></label></div><div class="form-row"><label>Sıra<input name="order" type="number" min="0" value="${content.sira??0}"></label><label>Görsel URL<input name="imageURL" type="url" value="${escapeHtml(content.imageURL||"")}"></label></div><label class="toggle-label"><input name="active" type="checkbox" ${content.aktif===false?"":"checked"}><span>İçerik yayında</span></label><div class="form-actions">${isNew?"":'<button id="delete-content" type="button" class="danger-button">İçeriği sil</button>'}<button class="accent-button" type="submit">Kaydet</button></div><p class="status"></p></form>`;
  $("#content-form").addEventListener("submit",async event=>{event.preventDefault();const f=event.currentTarget;const id=f.elements.id.value.trim().replace(/\s+/g,"-").toLowerCase();if(!id)return;const button=$("button[type=submit]",f);button.disabled=true;try{await setDoc(doc(db,"PandiKulupIcerikleri",id),{baslik:f.elements.title.value.trim(),kisaAciklama:f.elements.summary.value.trim(),detayMetni:f.elements.detail.value.trim(),kategori:f.elements.category.value.trim(),kategoriAdi:f.elements.categoryTitle.value.trim(),kategoriSembol:content.kategoriSembol||"sparkles",kartEtiketi:content.kartEtiketi||"PANDİ KULÜP",image:content.image||"",imageURL:f.elements.imageURL.value.trim(),begeniSayisi:content.begeniSayisi||0,yorumSayisi:content.yorumSayisi||0,kaydetmeSayisi:content.kaydetmeSayisi||0,yeni:content.yeni??true,aktif:f.elements.active.checked,sira:Number(f.elements.order.value)||0,guncellenmeTarihi:serverTimestamp()},{merge:true});state.activeContent=id;showToast("Kulüp içeriği kaydedildi.");}catch(error){showError(error);}finally{button.disabled=false;}});
  $("#delete-content")?.addEventListener("click",async()=>{if(!confirm("Bu Kulüp içeriğini silmek istediğine emin misin?"))return;try{await deleteDoc(doc(db,"PandiKulupIcerikleri",content.id));state.activeContent=null;$("#content-editor").innerHTML='<div class="detail-empty"><span>▧</span><strong>İçerik silindi</strong></div>';showToast("İçerik silindi.");}catch(error){showError(error);}});
}
$("#new-content").addEventListener("click",()=>{state.activeContent=null;renderContentEditor(null);});

function renderReports(){ const open=state.reports.filter(r=>(r.durum||"acik")!=="kapali").length; [["report-total",state.reports.length],["report-open",open],["report-closed",state.reports.length-open],["nav-reports",open]].forEach(([id,v])=>{const el=$(`#${id}`);if(el)el.textContent=v;}); const term=$("#report-search").value.trim().toLowerCase(); const shown=state.reports.filter(r=>(state.reportFilter==="all"||(r.durum||"acik")===state.reportFilter)&&`${r.bildirenKullaniciAdi||""} ${r.bildirilenKullaniciAdi||""} ${r.paylasimBasligi||""} ${r.neden||""}`.toLowerCase().includes(term)); $("#report-list").innerHTML=shown.map(r=>`<article class="report-card"><div><span class="badge ${(r.durum||"acik")==="kapali"?"resolved":"new"}">${(r.durum||"acik")==="kapali"?"Kapalı":"Açık"}</span><time>${formatDate(r.olusturulmaTarihi)}</time></div><small>${escapeHtml(r.hedefTipi||"Forum bildirimi")}</small><h3>${escapeHtml(r.paylasimBasligi||"Topluluk bildirimi")}</h3><p>${escapeHtml(r.aciklama||r.neden||"Açıklama bulunmuyor")}</p><dl><div><dt>BİLDİREN</dt><dd>${escapeHtml(r.bildirenKullaniciAdi||r.bildirenKullaniciID||"—")}</dd></div><div><dt>BİLDİRİLEN</dt><dd>${escapeHtml(r.bildirilenKullaniciAdi||r.bildirilenKullaniciID||"—")}</dd></div></dl><button data-report-id="${r.id}" data-next-status="${(r.durum||"acik")==="kapali"?"acik":"kapali"}">${(r.durum||"acik")==="kapali"?"Yeniden aç":"İncelendi olarak kapat"}</button></article>`).join("")||'<div class="empty">Bu görünümde şikâyet yok.</div>'; $$('[data-report-id]',$("#report-list")).forEach(button=>button.addEventListener("click",async()=>{button.disabled=true;try{await updateDoc(doc(db,"Sikayetler",button.dataset.reportId),{durum:button.dataset.nextStatus,cozumTarihi:serverTimestamp(),islemYapanAdminID:auth.currentUser.uid});showToast("Şikâyet durumu güncellendi.");}catch(error){showError(error);}finally{button.disabled=false;}})); }
$("#report-search").addEventListener("input",renderReports); $$('[data-report-filter]').forEach(button=>button.addEventListener("click",()=>{$$('[data-report-filter]').forEach(x=>x.classList.remove("active"));button.classList.add("active");state.reportFilter=button.dataset.reportFilter;renderReports();}));

function renderTickets(){ const tickets=state.tickets; $("#stat-total").textContent=tickets.length;$("#stat-new").textContent=tickets.filter(x=>x.status==="new").length;$("#stat-progress").textContent=tickets.filter(x=>x.status==="in_progress").length;$("#stat-done").textContent=tickets.filter(x=>x.status==="resolved").length;const term=$("#ticket-search").value.trim().toLowerCase();const shown=tickets.filter(x=>(state.ticketFilter==="all"||x.status===state.ticketFilter)&&`${x.id} ${x.uid||""} ${x.name||""} ${x.email||""} ${x.category||""} ${x.message||""} ${x.lastMessage||""}`.toLowerCase().includes(term));$("#ticket-list").innerHTML=shown.map(ticket=>`<article class="ticket ${ticket.id===state.activeTicket?"active":""}" data-ticket-id="${ticket.id}"><div class="ticket-code"><strong>${codeFor(ticket.id)}</strong><span class="badge ${ticket.status}">${statusLabel(ticket.status)}</span><small>${formatDate(ticket.updatedAt||ticket.createdAt)}</small></div><div class="ticket-main"><small>${escapeHtml(ticket.category)}</small><strong>${escapeHtml(ticket.name)} · ${escapeHtml(ticket.email)}</strong><p>${escapeHtml(ticket.lastMessage||ticket.message)}</p></div></article>`).join("")||'<div class="empty">Bu görünümde destek talebi yok.</div>';$$('[data-ticket-id]',$("#ticket-list")).forEach(card=>card.addEventListener("click",()=>openTicket(card.dataset.ticketId))); }
function openTicket(id){state.activeTicket=id;stopMessages?.();renderTickets();const ticket=state.tickets.find(x=>x.id===id);if(!ticket)return;renderTicketDetail(ticket);const messages=$("#admin-messages");stopMessages=onSnapshot(query(collection(db,"DestekTalepleri",id,"Mesajlar"),orderBy("createdAt","asc")),snapshot=>{const items=snapshot.docs.map(x=>normalizeMessage(x.data())).filter(x=>x.text);if(!items.some(x=>x.senderRole==="user"&&x.text===ticket.message))items.unshift(normalizeMessage({senderRole:"user",text:ticket.message,createdAt:ticket.createdAt}));messages.innerHTML=items.map(message=>`<article class="admin-message ${message.senderRole=== "admin"?"admin":"user"}"><small>${message.senderRole==="admin"?"PANDİ DESTEK":"KULLANICI"}</small><p>${escapeHtml(message.text)}</p><time>${formatDate(message.createdAt)}</time></article>`).join("");messages.scrollTop=messages.scrollHeight;},error=>{console.error(error);messages.innerHTML='<div class="empty">Mesajlar yüklenemedi.</div>';});}
const normalizeMessage=m=>({senderRole:m.senderRole||m.role||(m.isAdmin?"admin":"user"),text:m.text||m.message||m.content||"",createdAt:m.createdAt||m.timestamp||m.sentAt});
function renderTicketDetail(ticket){const provider=({"google.com":"Google","apple.com":"Apple",password:"E-posta ve şifre"}[ticket.authProvider])||ticket.authProvider||"Eski kayıt";$("#ticket-detail").innerHTML=`<header class="detail-header"><div><small>${codeFor(ticket.id)}</small><h2>${escapeHtml(ticket.category)}</h2><p>${escapeHtml(ticket.name)} · ${escapeHtml(ticket.email)}</p></div><select id="detail-status"><option value="new" ${ticket.status==="new"?"selected":""}>Yeni</option><option value="in_progress" ${ticket.status==="in_progress"?"selected":""}>İnceleniyor</option><option value="resolved" ${ticket.status==="resolved"?"selected":""}>Çözüldü</option></select></header><section class="detail-meta"><div><small>KULLANICI UID</small><strong>${escapeHtml(ticket.uid||"Bilinmiyor")}</strong></div><button id="copy-uid" ${ticket.uid?"":"disabled"}>UID’yi kopyala</button><div><small>GİRİŞ YÖNTEMİ</small><strong>${escapeHtml(provider)}</strong></div><div><small>KAYNAK</small><strong>${escapeHtml(ticket.source||"pandi-web")}</strong></div><div><small>OLUŞTURULMA</small><strong>${formatDate(ticket.createdAt)}</strong></div><div><small>SON GÜNCELLEME</small><strong>${formatDate(ticket.updatedAt||ticket.createdAt)}</strong></div></section><div id="admin-messages" class="admin-messages"><div class="empty">Konuşma yükleniyor…</div></div><form id="admin-reply" class="admin-reply"><textarea name="message" minlength="2" maxlength="3000" required placeholder="Kullanıcıya yanıt yaz…"></textarea><button type="submit">Yanıtla ↑</button><small class="email-note">Yanıt konuşmaya ve e-posta bildirim kuyruğuna eklenir.</small><p class="status"></p></form>`;$("#detail-status").addEventListener("change",async event=>{event.target.disabled=true;try{await updateDoc(doc(db,"DestekTalepleri",ticket.id),{status:event.target.value,updatedAt:serverTimestamp()});}catch(error){showError(error);event.target.value=ticket.status;}finally{event.target.disabled=false;}});$("#copy-uid")?.addEventListener("click",async()=>{await navigator.clipboard.writeText(ticket.uid);showToast("UID kopyalandı.");});$("#admin-reply").addEventListener("submit",sendReply);}
async function sendReply(event){event.preventDefault();const ticket=state.tickets.find(x=>x.id===state.activeTicket);const form=event.currentTarget;const text=form.elements.message.value.trim();if(!ticket||!text)return;const button=$("button",form);button.disabled=true;try{const ticketRef=doc(db,"DestekTalepleri",ticket.id);const messageRef=doc(collection(ticketRef,"Mesajlar"));const batch=writeBatch(db);batch.set(messageRef,{senderId:auth.currentUser.uid,senderRole:"admin",text,createdAt:serverTimestamp()});batch.update(ticketRef,{status:"in_progress",updatedAt:serverTimestamp(),lastMessage:text.slice(0,200),lastMessageAt:serverTimestamp(),lastSender:"admin"});await batch.commit();try{const mailRef=doc(collection(db,"mail"));await setDoc(mailRef,{ticketId:ticket.id,to:ticket.email,createdAt:serverTimestamp(),message:{subject:`Pandi Destek yanıtladı · ${codeFor(ticket.id)}`,text:`Merhaba ${ticket.name},\n\nPandi Destek yanıtladı:\n\n${text}\n\nhttps://alt4ns.github.io/pandi-app/support.html`,html:`<p>Merhaba ${escapeHtml(ticket.name)},</p><p><strong>Pandi Destek yanıtladı:</strong></p><p>${escapeHtml(text).replace(/\n/g,"<br>")}</p><p><a href="https://alt4ns.github.io/pandi-app/support.html">Talebi görüntüle</a></p>`}});}catch(error){console.warn(error);}form.reset();showToast("Destek yanıtı kaydedildi.");}catch(error){showError(error,"Yanıt kaydedilemedi.");}finally{button.disabled=false;}}
$("#ticket-search").addEventListener("input",renderTickets);$$('[data-filter]').forEach(button=>button.addEventListener("click",()=>{$$('[data-filter]').forEach(x=>x.classList.remove("active"));button.classList.add("active");state.ticketFilter=button.dataset.filter;renderTickets();}));

renderDashboard(); renderUsers(); renderNotifications(); renderContent(); renderReports(); renderTickets();
