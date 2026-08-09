import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, OAuthProvider, createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { addDoc, collection, getFirestore, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const form = document.querySelector("#support-form");
const formStatus = document.querySelector("#support-status");
const authBox = document.querySelector("#support-auth");
const authStatus = document.querySelector("#auth-status");
const accountBar = document.querySelector("#account-bar");
let currentUser = null;

const authMessage = (error) => {
  const code = error?.code || "";
  if (code.includes("popup-closed")) return "Giriş penceresi kapatıldı.";
  if (code.includes("account-exists-with-different-credential")) return "Bu e-posta başka bir giriş yöntemiyle kayıtlı.";
  if (code.includes("email-already-in-use")) return "Bu e-posta ile zaten bir hesap var. Giriş yapmayı dene.";
  if (code.includes("invalid-credential")) return "E-posta veya şifre hatalı.";
  if (code.includes("weak-password")) return "Şifren en az 6 karakter olmalı.";
  if (code.includes("operation-not-allowed")) return "Bu giriş yöntemi henüz Firebase Console’da etkinleştirilmemiş.";
  return "Giriş tamamlanamadı. Lütfen tekrar dene.";
};

const runAuth = async (action) => {
  authStatus.className = "support-status";
  authStatus.textContent = "Güvenli giriş hazırlanıyor…";
  try { await action(); }
  catch (error) { console.error("Authentication failed", error); authStatus.className = "support-status error"; authStatus.textContent = authMessage(error); }
};

document.querySelector("#google-login")?.addEventListener("click", () => runAuth(() => signInWithPopup(auth, new GoogleAuthProvider())));
document.querySelector("#apple-login")?.addEventListener("click", () => runAuth(() => signInWithPopup(auth, new OAuthProvider("apple.com"))));
document.querySelector("#email-login")?.addEventListener("click", () => runAuth(() => signInWithEmailAndPassword(auth, document.querySelector("#auth-email").value.trim(), document.querySelector("#auth-password").value)));
document.querySelector("#email-register")?.addEventListener("click", () => runAuth(async () => {
  const result = await createUserWithEmailAndPassword(auth, document.querySelector("#auth-email").value.trim(), document.querySelector("#auth-password").value);
  await updateProfile(result.user, { displayName: result.user.email.split("@")[0] });
}));
document.querySelector("#logout")?.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  authBox.hidden = !!user;
  accountBar.hidden = !user;
  form.hidden = !user;
  if (user) {
    const label = user.displayName || user.email;
    document.querySelector("#account-name").textContent = label;
    document.querySelector("#account-avatar").textContent = label.slice(0, 1).toUpperCase();
    form.elements.name.value = user.displayName || "";
    authStatus.textContent = "";
  }
});

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser || !form.reportValidity() || form.elements.website.value) return;
  const button = form.querySelector("button[type='submit']");
  const data = new FormData(form);
  button.disabled = true;
  formStatus.className = "support-status";
  formStatus.textContent = "Talebin güvenli biçimde kaydediliyor…";
  try {
    const request = await addDoc(collection(db, "DestekTalepleri"), {
      uid: currentUser.uid,
      name: data.get("name").trim(),
      email: currentUser.email,
      category: data.get("category"),
      message: data.get("message").trim(),
      status: "new",
      source: "pandi-web",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    formStatus.className = "support-status success";
    formStatus.textContent = `Talebin oluşturuldu. Takip numaran: PND-${request.id.slice(0, 8).toUpperCase()}`;
    form.elements.category.value = "";
    form.elements.message.value = "";
    form.elements.consent.checked = false;
  } catch (error) {
    console.error("Support request failed", error);
    formStatus.className = "support-status error";
    formStatus.textContent = "Talep şu anda kaydedilemedi. Lütfen alt4ns@icloud.com adresine e-posta gönder.";
  } finally { button.disabled = false; }
});
