// js/index.js — 로그아웃 전용 (카운트 + 갤러리 + 가입조건 게이트 + 정원마감 안내)

/* =========================
   Firebase (읽기 전용)
   ========================= */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js";
import {
  getFirestore, collection, query, where, getCountFromServer
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
   상단 표기 (모집 상태: 남/여 모집 · 남 모집 · 여 모집 · 마감)
   ========================= */
const LIMIT_GENDER = 10;
let __statusReqId = 0;

// 상태 문자열 계산
function groupStatus(mCount, fCount){
  const mFull = mCount >= LIMIT_GENDER;
  const fFull = fCount >= LIMIT_GENDER;
  if (mFull && fFull) return "마감";
  if (!mFull && !fFull) return "남/여 모집";
  if (!mFull && fFull)  return "남 모집";
  if (mFull && !fFull)  return "여 모집";
  return "남/여 모집";
}

// DOM에 상태 넣기 (기존 cnt-..를 재사용)
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


let __MALE_ALL_CLOSED   = false;
let __FEMALE_ALL_CLOSED = false;
let __ALL_FULL = false;           // ← 추가


async function refreshStatuses(){
  try{
    const reqId = ++__statusReqId;
    const usersRef = collection(db, "users");

    // 남/여 × (캠핑/보드/운동) 카운트
    const [
      campM, campF, boardM, boardF, sportM, sportF
    ] = await Promise.all([
      getCountFromServer(query(usersRef, where("groups.camp","==",true),  where("gender","==","남"))),
      getCountFromServer(query(usersRef, where("groups.camp","==",true),  where("gender","==","여"))),
      getCountFromServer(query(usersRef, where("groups.board","==",true), where("gender","==","남"))),
      getCountFromServer(query(usersRef, where("groups.board","==",true), where("gender","==","여"))),
      getCountFromServer(query(usersRef, where("groups.sport","==",true), where("gender","==","남"))),
      getCountFromServer(query(usersRef, where("groups.sport","==",true), where("gender","==","여"))),
    ]);

    if (reqId !== __statusReqId) return;

    const cM = campM.data().count  || 0, cF = campF.data().count  || 0;
    const bM = boardM.data().count || 0, bF = boardF.data().count || 0;
    const sM = sportM.data().count || 0, sF = sportF.data().count || 0;

    // 1) 상단 텍스트 교체
    setStatusBadge("st-camp",  groupStatus(cM, cF));
    setStatusBadge("st-board", groupStatus(bM, bF));
    setStatusBadge("st-sport", groupStatus(sM, sF));


    // 2) 한쪽 성별이 세 모임 모두 마감인지 플래그
    __MALE_ALL_CLOSED   = (cM >= LIMIT_GENDER) && (bM >= LIMIT_GENDER) && (sM >= LIMIT_GENDER);
    __FEMALE_ALL_CLOSED = (cF >= LIMIT_GENDER) && (bF >= LIMIT_GENDER) && (sF >= LIMIT_GENDER);

    // 회원가입 버튼 시각 피드백(둘 다 막힌 경우만 흐리게)
    const signBtn = $("#btnSignUp");
    if (signBtn) {
      const bothClosed = __MALE_ALL_CLOSED && __FEMALE_ALL_CLOSED;
      __ALL_FULL = bothClosed;          // ← 추가
      signBtn.setAttribute("aria-disabled", bothClosed ? "true" : "false");
      signBtn.style.opacity = bothClosed ? "0.65" : "";
    }

    // signup 페이지에서 쓸 수 있게 세션 공유(선택)
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

// 최초/재진입/재연결 시 집계
document.addEventListener("DOMContentLoaded", refreshStatuses);
document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="visible") refreshStatusesDebounced(); });
window.addEventListener("online", refreshStatusesDebounced);


/* =========================
   갤러리 (공개)
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
    // 캐시 우회
    im.src = src + (src.includes("?") ? "&" : "?") + "v=" + Date.now();
  });
}

async function loadPictures(){
  if(!galleryEl) return;

  // 1) 파일 목록(list.json) 시도
  let files = null;
  try{
    const res = await fetch("image/photo/list.json", { cache:"no-cache" });
    if(res.ok){
      const json = await res.json();
      if(Array.isArray(json)) files = json.map(n => "image/photo/" + n);
    }
  }catch{ /* ignore */ }

  // 2) 폴백: sample1~12.(jpg|jpeg|png) 스캔
  if(!files){
    const exts = ["jpg","jpeg","png"];
    const maxN = 12;
    const results = [];
    let miss = 0;
    for(let i=1;i<=maxN;i++){
      let found = null;
      for(const ext of exts){
        const src = `image/photo/sample${i}.${ext}`;
        // eslint-disable-next-line no-await-in-loop
        const ok = await probeImage(src);
        if(ok){ found = src; break; }
      }
      if(found){ results.push(found); miss = 0; }
      else { miss++; if(miss >= 3) break; } // 연속 누락 3회면 종료
    }
    files = results;
  }

  if(!files || files.length === 0){
    galleryEl.style.display = "none";
    return;
  }

  galleryEl.innerHTML = files.map(p => `
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

// 이미지 모달 닫기
imgModal && imgModal.addEventListener("click", e=>{
  if(e.target === imgModal) hideImgModal();
});
document.addEventListener("keydown", (e)=>{
  if(e.key === "Escape") hideImgModal();
});
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
  // 모든 모임 정원 마감 → 안내만
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
    // 정원 마감 여부는 openSignupGate 내부에서 체크
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
