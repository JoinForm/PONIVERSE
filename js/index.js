// js/index.js — 로그아웃 전용 (카운트 + 갤러리)

/* =========================
   Firebase (읽기 전용 용도)
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
   상단 카운트 (읽기 전용)
   — Firestore 필드: groups.camp/board/sport
   ========================= */
const LIMIT = 20;
let __countReqId = 0;
let __refreshTimer = null;

function setCountUI(id, n){
  const el = document.getElementById(id);
  if(!el) return;
  el.textContent = String(Math.min(n, LIMIT));
  el.style.color = n >= LIMIT ? "#ff4d4d" : "#66d1ff";
}

async function refreshCounts(){
  try{
    const usersRef = collection(db, "users");
    const reqId = ++__countReqId;

    const [campSnap, boardSnap, sportSnap] = await Promise.all([
      getCountFromServer(query(usersRef, where("groups.camp",  "==", true))),
      getCountFromServer(query(usersRef, where("groups.board", "==", true))),
      getCountFromServer(query(usersRef, where("groups.sport", "==", true))),
    ]);

    if(reqId !== __countReqId) return;

    const camp  = campSnap.data().count  || 0;
    const board = boardSnap.data().count || 0;
    const sport = sportSnap.data().count || 0;

    setCountUI("c1", camp);
    setCountUI("c2", board);
    setCountUI("c3", sport);
  }catch(err){
    console.error("[refreshCounts] failed:", err);
  }
}
function refreshCountsDebounced(){
  clearTimeout(__refreshTimer);
  __refreshTimer = setTimeout(()=>refreshCounts(), 60);
}

// 최초/재진입/재연결 시 집계
document.addEventListener("DOMContentLoaded", refreshCounts);
document.addEventListener("visibilitychange", ()=>{
  if(document.visibilityState === "visible") refreshCountsDebounced();
});
window.addEventListener("online", refreshCountsDebounced);

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
    im.src = src + (src.includes("?") ? "&" : "?") + "v=" + Date.now(); // 캐시 우회
  });
}

async function loadPictures(){
  if(!galleryEl) return;

  // 1) 목록 파일 시도
  let files = null;
  try{
    const res = await fetch("image/photo/list.json", { cache:"no-cache" });
    if(res.ok){
      const json = await res.json();
      if(Array.isArray(json)) files = json.map(n => "image/photo/" + n);
    }
  }catch(_){ /* ignore */ }

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

  galleryEl.innerHTML = files.map(p=>{
    return `<img class="hover-zoom" src="${p}" alt="pic" onerror="this.style.display='none'">`;
  }).join("");

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

// 모달 닫기
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
