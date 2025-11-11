// js/index.js — 로그아웃 전용 (카운트 + 갤러리 + 가입조건 게이트 + 정원마감 안내)

/* =========================
   Firebase (읽기 전용)
   ========================= */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js";
import {
  getFirestore, collection, query, where, getCountFromServer,
  doc, getDoc, setDoc, updateDoc, serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAfs8ZN-2ANX0lYvT_WVcOMXRkNB5usuRw",
  authDomain: "poniverse-3c351.firebaseapp.com",
  projectId: "poniverse-3c351",
  storageBucket: "poniverse-3c351.appspot.com",
  messagingSenderId: "608146456053",
  appId: "1:608146456053:web:711de65e21a2e54a6574bc",
  measurementId: "G-GFRG38YKVW"
};
const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

/* =========================
   DOM 유틸 + 토스트
   ========================= */
const $  = (sel, ctx=document) => ctx.querySelector(sel);
const $$ = (sel, ctx=document) => Array.from(ctx.querySelectorAll(sel));

function notify(msg){
  let t = $("#toast") || $("#appToast");
  if(!t){
    t = document.createElement("div");
    t.id = "appToast";
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._hideTimer);
  t._hideTimer = setTimeout(()=> t.classList.remove("show"), 1800);
}

/* =========================
   방문자 카운터(1일 1회/브라우저)
   ========================= */
function ensureVisitEl(){
  let el = document.getElementById("visitNote");
  if(!el){
    el = document.createElement("p");
    el.id = "visitNote";
    el.className = "visit-note";
    const countsLine = document.getElementById("countsLine") || document.querySelector(".mini-counts");
    (countsLine?.parentNode || document.body).insertBefore(el, countsLine?.nextSibling || null);
  }
  return el;
}

function fmt(n){ return Number(n || 0).toLocaleString("ko-KR"); }

async function showTotalVisitors(){
  const el = ensureVisitEl();
  try{
    const ref = doc(db, "metrics", "visitors");
    const snap = await getDoc(ref);
    const total = snap.exists() ? (snap.data().total || 0) : 0;
    el.innerHTML = `벌써 <span class="visit-num">${fmt(total)}</span>명이 포니버스에 들러주셨어요!`;
  }catch(e){
    console.warn("[visit] read failed", e);
    el.textContent = "";
  }
}

function todayId(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

async function recordDailyVisitOnce(){
  const key = "pv_" + todayId();
  if(localStorage.getItem(key) === "1") return false;

  try {
    const totalRef = doc(db, "metrics", "visitors");
    await setDoc(totalRef, { total: 0 }, { merge: true });
    await updateDoc(totalRef, {
      total: increment(1),
      updatedAt: serverTimestamp()
    });

    const dailyRef = doc(db, "daily_visits", todayId());
    await setDoc(dailyRef, { count: 0, date: todayId() }, { merge: true });
    await updateDoc(dailyRef, {
      count: increment(1),
      updatedAt: serverTimestamp()
    });

    localStorage.setItem(key, "1");
    return true;
  } catch (err) {
    console.error("[visit] increment failed:", err);
    notify("방문 카운트 저장이 차단되었습니다(보안 규칙 확인).");
    return false;
  }
}

/* =========================
   상단 표기 (모집 상태)
   ========================= */
const LIMIT_GENDER = 10;
let __statusReqId = 0;
let __refreshTimer = null;
let __MALE_ALL_CLOSED   = false;
let __FEMALE_ALL_CLOSED = false;
let __ALL_FULL = false;

function groupStatus(mCount, fCount){
  const mFull = mCount >= LIMIT_GENDER;
  const fFull = fCount >= LIMIT_GENDER;
  if (mFull && fFull) return "마감";
  if (!mFull && !fFull) return "남/여 모집";
  if (!mFull && fFull)  return "남 모집";
  if (mFull && !fFull)  return "여 모집";
  return "남/여 모집";
}

function setStatusBadge(id, status){
  const el = document.getElementById(id);
  if (!el) return;
  const cls =
    status === "마감"    ? "closed" :
    status === "남 모집" ? "male"   :
    status === "여 모집" ? "female" : "both";
  el.className = "status-badge " + cls;
  el.textContent = status;
}

async function refreshStatuses(){
  try{
    const reqId = ++__statusReqId;
    const usersRef = collection(db, "users");
    const [
      campM, campF, boardM, boardF, sportM, sportF
    ] = await Promise.all([
      getCountFromServer(query(usersRef, where("groups.camp","==",true),  where("gender","==","남"), where("role","==","member"))),
      getCountFromServer(query(usersRef, where("groups.camp","==",true),  where("gender","==","여"), where("role","==","member"))),
      getCountFromServer(query(usersRef, where("groups.board","==",true), where("gender","==","남"), where("role","==","member"))),
      getCountFromServer(query(usersRef, where("groups.board","==",true), where("gender","==","여"), where("role","==","member"))),
      getCountFromServer(query(usersRef, where("groups.sport","==",true), where("gender","==","남"), where("role","==","member"))),
      getCountFromServer(query(usersRef, where("groups.sport","==",true), where("gender","==","여"), where("role","==","member"))),
    ]);

    if (reqId !== __statusReqId) return;
    const cM = campM.data().count || 0, cF = campF.data().count || 0;
    const bM = boardM.data().count || 0, bF = boardF.data().count || 0;
    const sM = sportM.data().count || 0, sF = sportF.data().count || 0;

    setStatusBadge("st-camp",  groupStatus(cM, cF));
    setStatusBadge("st-board", groupStatus(bM, bF));
    setStatusBadge("st-sport", groupStatus(sM, sF));

    __MALE_ALL_CLOSED   = (cM >= LIMIT_GENDER) && (bM >= LIMIT_GENDER) && (sM >= LIMIT_GENDER);
    __FEMALE_ALL_CLOSED = (cF >= LIMIT_GENDER) && (bF >= LIMIT_GENDER) && (sF >= LIMIT_GENDER);

    const signBtn = $("#btnSignUp");
    if (signBtn) {
      const bothClosed = __MALE_ALL_CLOSED && __FEMALE_ALL_CLOSED;
      __ALL_FULL = bothClosed;
      signBtn.setAttribute("aria-disabled", bothClosed ? "true" : "false");
      signBtn.style.opacity = bothClosed ? "0.65" : "";
    }
  }catch(err){
    console.error("[refreshStatuses] failed:", err);
  }
}

function refreshStatusesDebounced(){
  clearTimeout(__refreshTimer);
  __refreshTimer = setTimeout(()=>refreshStatuses(), 60);
}

document.addEventListener("DOMContentLoaded", refreshStatuses);
document.addEventListener("DOMContentLoaded", async ()=>{
  await showTotalVisitors();
  const added = await recordDailyVisitOnce();
  if(added) await showTotalVisitors();
});
document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="visible") refreshStatusesDebounced(); });
window.addEventListener("online", refreshStatusesDebounced);

/* =========================
   1:1 문의 버튼 (카카오톡)
   ========================= */
document.addEventListener("DOMContentLoaded", ()=>{
  const kakaoBtn = document.createElement("button");
  kakaoBtn.className = "btn ghost";
  kakaoBtn.textContent = "1:1 문의";
  kakaoBtn.addEventListener("click", ()=> window.open("https://open.kakao.com/o/s24gqv1h", "_blank"));

  const loginBtn = document.getElementById("btnLogin");
  const logoutBtn = document.getElementById("btnLogout");

  if (loginBtn && loginBtn.parentNode) {
    loginBtn.parentNode.insertBefore(kakaoBtn, loginBtn.nextSibling);
  } else if (logoutBtn && logoutBtn.parentNode) {
    logoutBtn.parentNode.insertBefore(kakaoBtn, logoutBtn);
  }
});

/* =========================
   갤러리 (10개 단위 페이지네이션)
   ========================= */
const galleryEl = $("#gallery");
const imgModal  = $("#imgModal");
const modalImg  = $("#modalImg");

function hideImgModal(){
  if(!imgModal) return;
  imgModal.setAttribute("aria-hidden", "true");
  imgModal.setAttribute("hidden", "");
}

function probeImage(src){
  return new Promise(resolve=>{
    const im = new Image();
    im.onload  = ()=> resolve(src);
    im.onerror = ()=> resolve(null);
    im.src = src + (src.includes("?") ? "&" : "?") + "v=" + Date.now();
  });
}

let __currentPage = 1;
const __perPage = 10;
let __files = [];

async function loadPictures(){
  if(!galleryEl) return;
  let files = null;
  try{
    const res = await fetch("image/photo/list.json", { cache:"no-cache" });
    if(res.ok){
      const json = await res.json();
      if(Array.isArray(json)) files = json.map(n => "image/photo/" + n);
    }
  }catch{ /* ignore */ }

  if(!files){
    const exts = ["jpg","jpeg","png"];
    const maxN = 30;
    const results = [];
    for(let i=1;i<=maxN;i++){
      for(const ext of exts){
        const src = `image/photo/sample${i}.${ext}`;
        const ok = await probeImage(src);
        if(ok){ results.push(src); break; }
      }
    }
    files = results;
  }

  if(!files || files.length === 0){
    galleryEl.style.display = "none";
    return;
  }

  __files = files;
  renderGalleryPage(__currentPage);
  renderPaginationControls();
}

function renderGalleryPage(page){
  const start = (page - 1) * __perPage;
  const end = start + __perPage;
  const list = __files.slice(start, end);
  galleryEl.innerHTML = list.map(p => `<img class="hover-zoom" src="${p}" alt="pic" loading="lazy">`).join("");
  galleryEl.querySelectorAll("img").forEach(img=>{
    img.addEventListener("click", ()=>{
      if(modalImg && imgModal){
        modalImg.src = img.src;
        imgModal.removeAttribute("hidden");
        imgModal.setAttribute("aria-hidden", "false");
      }
    });
  });
}

function renderPaginationControls(){
  let pagEl = document.getElementById("galleryPager");
  if(!pagEl){
    pagEl = document.createElement("div");
    pagEl.id = "galleryPager";
    pagEl.className = "gallery-pager";
    galleryEl.after(pagEl);
  }
  const totalPages = Math.ceil(__files.length / __perPage);
  pagEl.innerHTML = Array.from({length: totalPages}, (_, i)=> i+1)
    .map(i => `<button class="page-btn${i===__currentPage?" active":""}" data-page="${i}">${i}</button>`).join("");
  pagEl.querySelectorAll("button").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      __currentPage = parseInt(btn.dataset.page, 10);
      renderGalleryPage(__currentPage);
      renderPaginationControls();
      window.scrollTo({top: galleryEl.offsetTop - 100, behavior:"smooth"});
    });
  });
}

imgModal && imgModal.addEventListener("click", e=>{ if(e.target === imgModal) hideImgModal(); });
document.addEventListener("keydown", e=>{ if(e.key === "Escape") hideImgModal(); });

loadPictures();

/* =========================
   가입조건 게이트 모달
   ========================= */
function openSignupGate(){
  if (__ALL_FULL) {
    notify("정원마감으로 모집이 종료되었습니다.");
    return;
  }
  const m = $("#signupGate");
  if(!m){ location.href = "signup.html"; return; }
  const p = m.querySelector(".modal__panel");
  m.classList.add("is-open");
  m.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  setTimeout(()=> p && p.focus(), 0);
}
function closeSignupGate(){
  const m = $("#signupGate");
  if(!m) return;
  m.classList.remove("is-open");
  m.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

(function bindSignupGateUI(){
  const btnOpen = $("#btnSignUp");
  if(!btnOpen) return;
  const modal = $("#signupGate");
  const agree = $("#agreeChk");
  const goBtn = $("#goSignup");
  btnOpen.addEventListener("click", (e)=>{
    e.preventDefault();
    if (modal && agree && goBtn) {
      agree.checked = false;
      goBtn.disabled = true;
    }
    openSignupGate();
  });
  if(modal && agree && goBtn){
    agree.addEventListener("change", ()=>{ goBtn.disabled = !agree.checked; });
    goBtn.addEventListener("click", ()=>{
      if(!agree.checked) return;
      closeSignupGate();
      location.href = "signup.html";
    });
    modal.addEventListener("click", (e)=>{
      if(e.target.matches("[data-close]")) closeSignupGate();
    });
    document.addEventListener("keydown", (e)=>{
      if(e.key === "Escape" && modal.classList.contains("is-open")) closeSignupGate();
    });
  }
})();
