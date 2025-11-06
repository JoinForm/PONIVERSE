// js/app.js

// ===== Firebase =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signOut, deleteUser,
  setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, updateDoc, serverTimestamp,
  collection, query, where, getCountFromServer, deleteDoc
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
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// 로그인 상태 유지
await setPersistence(auth, browserLocalPersistence);

// ===== DOM utils =====
const $  = (sel, ctx=document) => ctx.querySelector(sel);
const $$ = (sel, ctx=document) => Array.from(ctx.querySelectorAll(sel));

// 기본 인증 상태
document.body.dataset.auth = "out";

// ===== Toast =====
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

// ===== 로그아웃 UI 잠금 =====
function forceLoggedOutUI(){
  $("#groups")?.setAttribute("aria-hidden", "true");
  $("#groupsNotice")?.setAttribute("aria-hidden", "true");
  $(".page-actions")?.setAttribute("aria-hidden", "true");
}
forceLoggedOutUI();

/* =========================
   그룹 링크 로딩 (links.json)
   ========================= */
let GROUP_LINKS = { camp:"#", board:"#", sport:"#", free:"#"};
async function loadGroupLinks(){
  try{
    const res = await fetch("config/links.json", { cache:"no-cache" });
    if(res.ok){
      const json = await res.json();
      GROUP_LINKS = { ...GROUP_LINKS, ...json };
    }
  }catch(e){
    console.warn("[links.json] load failed, fallback to #", e);
  }
}

function openLink(link, { newTab = true } = {}) {
  if (!link || link === "#") return;

  // 모바일 브라우저 팝업 차단 회피용 (유저 제스처 내 실행)
  try {
    if (newTab) {
      // 대부분 브라우저에서 새 탭 허용
      const a = document.createElement("a");
      a.href = link;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } else {
      // 새 탭이 막히거나 같은 탭으로 이동하고 싶을 때
      window.location.href = link;
    }
  } catch (err) {
    console.error("openLink 실패:", err);
    window.location.href = link; // fallback
  }
}



/* =========================
   상단 카운트 — 병렬 + 디바운스
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

async function refreshCounts({optimisticDelta} = {}){
  try{
    const usersRef = collection(db, "users");
    const reqId = ++__countReqId;

    const [campSnap, boardSnap, sportSnap] = await Promise.all([
      getCountFromServer(query(usersRef, where("groups.camp",  "==", true))),
      getCountFromServer(query(usersRef, where("groups.board", "==", true))),
      getCountFromServer(query(usersRef, where("groups.sport", "==", true))),
    ]);

    if(reqId !== __countReqId) return;

    let camp  = campSnap.data().count  || 0;
    let board = boardSnap.data().count || 0;
    let sport = sportSnap.data().count || 0;

    if(optimisticDelta){
      if(typeof optimisticDelta.camp  === "number")  camp  = Math.max(0, camp  + optimisticDelta.camp);
      if(typeof optimisticDelta.board === "number")  board = Math.max(0, board + optimisticDelta.board);
      if(typeof optimisticDelta.sport === "number")  sport = Math.max(0, sport + optimisticDelta.sport);
    }

    setCountUI("c1", camp);
    setCountUI("c2", board);
    setCountUI("c3", sport);
  }catch(err){
    console.error("[refreshCounts] failed:", err);
  }
}
function refreshCountsDebounced(opts){
  clearTimeout(__refreshTimer);
  __refreshTimer = setTimeout(()=>refreshCounts(opts), 60);
}
document.addEventListener("DOMContentLoaded", ()=> refreshCounts());
document.addEventListener("visibilitychange", ()=>{
  if(document.visibilityState==="visible") refreshCountsDebounced();
});
window.addEventListener("online", ()=> refreshCountsDebounced());

/* =========================
   groups → Set 변환
   ========================= */
function groupsToSet(groups){
  const s = new Set();
  if(!groups) return s;
  const T = v => v === true || v === "true" || v === 1;
  if(T(groups.camp))  s.add("camp");
  if(T(groups.board)) s.add("board");
  if(T(groups.sport)) s.add("sport");
  if(T(groups.free))  s.add("free");
  return s;
}

/* =========================
   버튼/링크 동작
   ========================= */
function bindGroupButtons(){
  const groupsEl = document.getElementById("groups");
  if(!groupsEl) return;

  groupsEl.querySelectorAll(".group-btn").forEach(btn=>{
    btn.addEventListener("click", async (e)=>{
      // a.group-btn(이동하기)은 기본 앵커 동작 사용 → 보장 위해 별도 처리
      if(btn.matches("a.group-btn")){
        // 혹시 다른 핸들러가 e.preventDefault() 하더라도 강제 오픈
        const link = btn.getAttribute("href");
        if(link && link !== "#") openLink(link, { newTab:true });
        return;
      }

      e.preventDefault();
      const key  = btn.dataset.key;
      const card = btn.closest(".group-card");
      if(!key || !card) return;

      const titleMap = { camp:"캠핑", board:"보드게임", sport:"운동", free:"자유" };
      const title    = titleMap[key];
      const linkHref = GROUP_LINKS[key] || "#";

      const statusEl  = card.querySelector("[data-status]");
      const actionsEl = card.querySelector(".group-actions");

      const isWithdraw = btn.classList.contains("withdraw-btn");
      const willJoin   = !isWithdraw;

      // 자유: 탈퇴 금지
      if(key === "free" && !willJoin){
        notify("자유는 필참이라 탈퇴할 수 없습니다.");
        return;
      }
      // camp/board/sport 최소 1개 유지
      if(!willJoin && (key==="camp"||key==="board"||key==="sport")){
        const joinedOthers = Array.from(groupsEl.querySelectorAll(".group-card")).some(cardEl=>{
          const k = cardEl.dataset.key;
          if(k===key) return false;
          if(!(k==="camp"||k==="board"||k==="sport")) return false;
          return cardEl.querySelector("[data-status]")?.textContent?.trim() === "참가중";
        });
        if(!joinedOthers){
          notify("캠핑/보드게임/운동 중 최소 1개는 선택되어 있어야 합니다.");
          return;
        }
      }

      // ===== UI 즉시 반영
      if(willJoin){
        statusEl.textContent = "참가중";

        const withdrawBtn = document.createElement("button");
        withdrawBtn.className = "group-btn withdraw-btn";
        withdrawBtn.dataset.key = key;
        withdrawBtn.textContent = "탈퇴하기";
        btn.replaceWith(withdrawBtn);

        // 이동하기 버튼(앵커)
        const moveA = document.createElement("a");
        moveA.className = "group-btn move-btn";
        moveA.href = linkHref; moveA.target = "_blank"; moveA.rel = "noopener";
        moveA.textContent = "이동하기";
        actionsEl.insertBefore(moveA, withdrawBtn);

        notify(`${title} 참가되었습니다.`);
      }else{
        statusEl.textContent = "미참가";
        actionsEl.querySelector(".move-btn")?.remove();

        const joinBtn = document.createElement("button");
        joinBtn.className = "group-btn";
        joinBtn.dataset.key = key;
        joinBtn.textContent = "참가하기";
        btn.replaceWith(joinBtn);

        notify(`${title}에서 탈퇴했습니다.`);
      }

      // 새 버튼 재바인딩
      bindGroupButtons();

      // ===== DB 반영 + 카운트 옵티미스틱 + (참가하기면) 링크 열기
      const delta = { camp:0, board:0, sport:0 };
      if(key==="camp")  delta.camp  = willJoin ? +1 : -1;
      if(key==="board") delta.board = willJoin ? +1 : -1;
      if(key==="sport") delta.sport = willJoin ? +1 : -1;
      refreshCountsDebounced({ optimisticDelta: delta });

      try{
        // 링크는 사용자 제스처 안에서 먼저 열고, DB는 백그라운드로 처리
        if(willJoin && linkHref && linkHref !== "#"){
          openLink(linkHref, { newTab:true });
        }
        await window.toggleGroup?.(key, willJoin);
        refreshCountsDebounced();
      }catch(err){
        console.error("toggleGroup failed:", err);
        refreshCountsDebounced();
      }
    });
  });

  // 카드 썸네일 이미지를 클릭해도 확실히 링크 이동
  document.querySelectorAll(".group-card > a").forEach(a=>{
    a.addEventListener("click", (e)=>{
      e.preventDefault();
      const link = a.getAttribute("href");
      if(link && link !== "#") openLink(link, { newTab:true });
    });
  });
}

/* =========================
   Gallery (동일)
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
async function loadPictures(){
  if(!galleryEl) return;
  let files = null;
  try{
    const res = await fetch("image/photo/list.json", { cache:"no-cache" });
    if(res.ok){
      const json = await res.json();
      if(Array.isArray(json)) files = json.map(n => "image/photo/" + n);
    }
  }catch(_){}
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
      else { miss++; if(miss >= 3) break; }
    }
    files = results;
  }
  if(!files || files.length === 0){
    galleryEl.style.display = "none";
    return;
  }
  galleryEl.innerHTML = files.map(p=>(`<img class="hover-zoom" src="${p}" alt="pic" onerror="this.style.display='none'">`)).join("");
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
loadPictures();
imgModal && imgModal.addEventListener("click", e=>{ if(e.target === imgModal) hideImgModal(); });
document.addEventListener("keydown", (e)=>{ if(e.key === "Escape"){ hideImgModal(); }});
$$("[data-close]").forEach(btn=>{ btn.addEventListener("click", ()=>{ const id = btn.getAttribute("data-close"); if(id === "imgModal") hideImgModal(); }); });

/* =========================
   Groups 렌더 (링크 적용)
   ========================= */
function renderGroups(joinedSet){
  const groupsEl = document.getElementById("groups");
  if(!groupsEl) return;

  const items = [
    { key:"camp",  title:"캠핑",    img:"image/meeting/sample1.png" },
    { key:"board", title:"보드게임", img:"image/meeting/sample2.png" },
    { key:"sport", title:"운동",    img:"image/meeting/sample3.png" },
    { key:"free",  title:"자유",    img:"image/meeting/sample4.png" },
  ];

  groupsEl.innerHTML = items.map(it=>{
    const joined = joinedSet.has(it.key);
    const status = joined ? "참가중" : "미참가";
    const badge  = (it.key==="free")
      ? `<span class="badge required">필참</span>`
      : `<span class="badge optional">선택</span>`;

    const link   = GROUP_LINKS[it.key] || "#";
    const actions = joined
      ? `
        <a class="group-btn move-btn" href="${link}" target="_blank" rel="noopener">이동하기</a>
        <button class="group-btn withdraw-btn" data-key="${it.key}">탈퇴하기</button>
      `
      : `
        <button class="group-btn" data-key="${it.key}">참가하기</button>
      `;

    return `
      <article class="group-card" data-key="${it.key}">
        <a href="${link}" target="_blank" rel="noopener" title="${it.title}">
          <img class="group-thumb" src="${it.img}" alt="${it.title}" onerror="this.style.display='none'">
        </a>
        <div class="group-body">
          <h3 class="group-title">${it.title} ${badge}</h3>
          <div class="group-actions">
            <span class="group-status" data-status>${status}</span>
            ${actions}
          </div>
        </div>
      </article>`;
  }).join("");

  bindGroupButtons();
}

/* =========================
   Header / Auth / toggleGroup
   ========================= */
const groupsEl  = $("#groups");
const noticeEl  = $("#groupsNotice");
const actionsEl = $(".page-actions");
const btnRow    = $(".btn-row");

function setLoggedOutHeader(){
  if(!btnRow) return;
  btnRow.innerHTML = `
    <a href="signup.html" class="btn">회원가입</a>
    <a href="login.html"  class="btn ghost">로그인</a>`;
}
function setLoggedInHeader(){
  if(!btnRow) return;
  btnRow.innerHTML = `
    <a id="noticeBtn" class="btn primary" href="notice.html">공지사항</a>
    <button id="logoutBtn" class="btn ghost">로그아웃</button>`;
  $("#logoutBtn")?.addEventListener("click", async ()=>{
    try{
      await signOut(auth);
      notify("로그아웃되었습니다.");
    }catch(e){
      console.error(e);
      notify("로그아웃 실패");
    }
  });
}

window.toggleGroup = async function(key, join){
  const user = auth.currentUser;
  if(!user) return;
  const val = !!join;
  const upd = { updatedAt: serverTimestamp() };

  if(key==="camp"){   upd["groups.camp"]=val; }
  if(key==="board"){  upd["groups.board"]=val; }
  if(key==="sport"){  upd["groups.sport"]=val; }
  if(key==="free"){   upd["groups.free"]=val; }

  await updateDoc(doc(db,"users",user.uid), upd);
};

onAuthStateChanged(auth, async (user)=>{
  const loggedIn = !!user;
  document.body.dataset.auth = loggedIn ? "in" : "out";

  if(loggedIn){
    setLoggedInHeader();
    try{
      await loadGroupLinks(); // 🔗 링크 로드
      const snap = await getDoc(doc(db,"users", user.uid));
      const data = snap.exists() ? snap.data() : {};
      const joinedSet = groupsToSet(data?.groups);

      const subtitle = document.querySelector(".subtitle");
      const name = data?.name || user.displayName || (user.email?.split("@")[0] ?? "회원");
      if(subtitle) subtitle.textContent = `${name}님, 포니버스에 오신 것을 환영합니다`;

      renderGroups(joinedSet);
    }catch(err){
      console.error("load user failed:", err);
      renderGroups(new Set());
    }

    groupsEl ?.setAttribute("aria-hidden","false");
    noticeEl ?.setAttribute("aria-hidden","false");
    actionsEl?.setAttribute("aria-hidden","false");
    $("#groupsNotice") && ($("#groupsNotice").textContent = "자유는 필참이며, 캠핑/보드게임/운동 중 최소 1개를 선택하세요.");
    refreshCountsDebounced();
  }else{
    setLoggedOutHeader();
    forceLoggedOutUI();
    document.body.style.overflow = "";
    const subtitle = document.querySelector(".subtitle");
    if(subtitle) subtitle.textContent = "포니버스에 오신 것을 환영합니다";
    refreshCountsDebounced();
  }
});

/* =========================
   회원 탈퇴(계정 삭제) — 재활성화
   ========================= */
$("#withdrawBtn")?.addEventListener("click", async ()=>{
  const user = auth.currentUser;
  if(!user){
    notify("로그인 상태가 아닙니다.");
    return;
  }
  if(!confirm("정말 계정을 삭제하시겠습니까? 복구할 수 없습니다.")) return;

  try{
    // Firestore 문서 삭제
    await deleteDoc(doc(db, "users", user.uid));
    // Auth 계정 삭제
    await deleteUser(user);
    notify("계정이 완전히 삭제되었습니다.");
    setTimeout(()=> location.href = "index.html", 1200);
  }catch(err){
    console.error(err);
    if(err.code === "auth/requires-recent-login"){
      notify("보안을 위해 다시 로그인 후 탈퇴해 주세요.");
      setTimeout(()=> location.href = "login.html", 1200);
    }else{
      notify("계정 삭제 중 오류가 발생했습니다.");
    }
  }
});
