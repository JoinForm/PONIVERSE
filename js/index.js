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

    // countsLine(모집 상태 라인) 바로 아래 삽입
    const countsLine = document.getElementById("countsLine") || document.querySelector(".mini-counts");
    if (countsLine && countsLine.nextElementSibling) {
      countsLine.parentNode.insertBefore(el, countsLine.nextElementSibling);
    } else {
      (countsLine?.parentNode || document.body).appendChild(el);
    }
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
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
async function recordDailyVisitOnce(){
  const key = "pv_" + todayId();     // localStorage 키
  if(localStorage.getItem(key) === "1"){
    return false; // 오늘 이미 집계됨
  }
  // 총합 upsert + 증가
  const totalRef = doc(db, "metrics", "visitors");
  await setDoc(totalRef, { total: 0 }, { merge: true });
  await updateDoc(totalRef, {
    total: increment(1),
    updatedAt: serverTimestamp()
  });
  // 일자별 증가(선택)
  const dailyRef = doc(db, "daily_visits", todayId());
  await setDoc(dailyRef, { count: 0, date: todayId() }, { merge: true });
  await updateDoc(dailyRef, {
    count: increment(1),
    updatedAt: serverTimestamp()
  });
  localStorage.setItem(key, "1");
  return true;
}

/* =========================
   상단 표기 (모집 상태: 남/여 모집 · 남 모집 · 여 모집 · 마감)
   ========================= */
const LIMIT_GENDER = 10;
let __statusReqId = 0;
let __refreshTimer = null;   // ← 누락 방지용 추가
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

    // 관리자/운영진 제외: role == "member" 만 카운팅
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

    const cM = campM.data().count  || 0, cF = campF.data().count  || 0;
    const bM = boardM.data().count || 0, bF = boardF.data().count || 0;
    const sM = sportM.data().count || 0, sF = sportF.data().count || 0;

    // 상단 상태 배지 교체
    setStatusBadge("st-camp",  groupStatus(cM, cF));
    setStatusBadge("st-board", groupStatus(bM, bF));
    setStatusBadge("st-sport", groupStatus(sM, sF));

    // 성별별로 세 모임 모두 마감인지
    __MALE_ALL_CLOSED   = (cM >= LIMIT_GENDER) && (bM >= LIMIT_GENDER) && (sM >= LIMIT_GENDER);
    __FEMALE_ALL_CLOSED = (cF >= LIMIT_GENDER) && (bF >= LIMIT_GENDER) && (sF >= LIMIT_GENDER);

    // 회원가입 버튼 흐리기(둘 다 마감일 때만)
    const signBtn = $("#btnSignUp");
    if (signBtn) {
      const bothClosed = __MALE_ALL_CLOSED && __FEMALE_ALL_CLOSED;
      __ALL_FULL = bothClosed;
      signBtn.setAttribute("aria-disabled", bothClosed ? "true" : "false");
      signBtn.style.opacity = bothClosed ? "0.65" : "";
    }

    // signup 페이지에서 활용할 수 있게 세션 공유(선택)
    sessionStorage.setItem("__MALE_ALL_CLOSED",   JSON.stringify(__MALE_ALL_CLOSED));
    sessionStorage.setItem("__FEMALE_ALL_CLOSED", JSON.stringify(__FEMALE_ALL_CLOSED));
  }catch(err){
    console.error("[refreshStatuses] failed:", err);
  }
}
function refreshStatusesDebounced(){
  clearTimeout(__refreshTimer);
  __refreshTimer = setTimeout(()=>refreshStatuses(), 60);
}

// 최초/재진입/재연결 + 방문자 카운터
document.addEventListener("DOMContentLoaded", refreshStatuses);
document.addEventListener("DOMContentLoaded", async ()=>{
  await showTotalVisitors();                 // 합계 표시
  const added = await recordDailyVisitOnce();// 오늘 첫 방문이면 증가
  if(added) await showTotalVisitors();       // 증가 후 다시 표시
});
document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="visible") refreshStatusesDebounced(); });
window.addEventListener("online", refreshStatusesDebounced);

/* =========================
   갤러리 (공개) — 10개 단위 페이지네이션
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

  // 1) list.json 우선
  let files = null;
  try{
    const res = await fetch("image/photo/list.json", { cache:"no-cache" });
    if(res.ok){
      const json = await res.json();
      if(Array.isArray(json)) files = json.map(n => "image/photo/" + n);
    }
  }catch{ /* ignore */ }

  // 2) 폴백: sample1~N.(jpg|jpeg|png)
  if(!files){
    const exts = ["jpg","jpeg","png"];
    const maxN = 30; // 필요에 따라 확장
    const results = [];
    for(let i=1;i<=maxN;i++){
      for(const ext of exts){
        const src = `image/photo/sample${i}.${ext}`;
        // eslint-disable-next-line no-await-in-loop
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

  galleryEl.innerHTML = list.map(p => `
    <img class="hover-zoom" src="${p}" alt="pic"
         loading="lazy" decoding="async"
         onerror="this.style.display='none'">
  `).join("");

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
    .map(i => `<button class="page-btn${i===__currentPage?" active":""}" data-page="${i}">${i}</button>`)
    .join("");

  pagEl.querySelectorAll("button").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      __currentPage = parseInt(btn.dataset.page, 10);
      renderGalleryPage(__currentPage);
      renderPaginationControls();
      window.scrollTo({top: galleryEl.offsetTop - 100, behavior:"smooth"});
    });
  });
}

// 모달 닫기
imgModal && imgModal.addEventListener("click", e=>{ if(e.target === imgModal) hideImgModal(); });
document.addEventListener("keydown", (e)=>{ if(e.key === "Escape") hideImgModal(); });
$$("[data-close]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    const id = btn.getAttribute("data-close");
    if(id === "imgModal") hideImgModal();
  });
});

// 실행
loadPictures();

/* =========================
   가입조건 게이트 모달
   (동의해야 회원가입 이동, 정원마감 시 차단)
   ========================= */
function openSignupGate(){
  if (__ALL_FULL) {
    notify("정원마감으로 모집이 종료되었습니다.");
    return;
  }
  const m = $("#signupGate");
  if(!m){ location.href = "signup.html"; return; } // 모달 없으면 바로 이동
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

// 초기 바인딩(IIFE)
(function bindSignupGateUI(){
  const btnOpen = $("#btnSignUp");
  if(!btnOpen) return;

  const modal = $("#signupGate");
  const agree = $("#agreeChk");
  const goBtn = $("#goSignup");

  // 회원가입 버튼
  btnOpen.addEventListener("click", (e)=>{
    e.preventDefault();
    if (modal && agree && goBtn) {
      agree.checked = false;
      goBtn.disabled = true;
    }
    openSignupGate();
  });

  // 모달 요소가 모두 있을 때만 아래 로직 바인딩
  if(modal && agree && goBtn){
    // 동의 체크해야 진행 버튼 활성화
    agree.addEventListener("change", ()=>{ goBtn.disabled = !agree.checked; });

    // 진행 → 회원가입 페이지
    goBtn.addEventListener("click", ()=>{
      if(!agree.checked) return;
      closeSignupGate();
      location.href = "signup.html";
    });

    // 오버레이/닫기 버튼
    modal.addEventListener("click", (e)=>{
      if(e.target.matches("[data-close]")) closeSignupGate();
    });

    // ESC 닫기
    document.addEventListener("keydown", (e)=>{
      if(e.key === "Escape" && modal.classList.contains("is-open")) closeSignupGate();
    });
  }
})();
