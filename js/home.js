// js/home.js — 홈(로그인 후)
// - 그룹 카드 + 남/여 인원 칩(캠핑/보드/운동/자유 모두)
// - 참가/탈퇴 토글 + 낙관적 UI
// - (선택) 상단 총원 카운트: DOM 없으면 자동 스킵
// - 외부 링크 로딩(links.json)
// - 로그아웃/회원탈퇴

/* =========================
   Firebase 초기화
   ========================= */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signOut, deleteUser,
  setPersistence, browserLocalPersistence, updateProfile
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
const ROLE_MEMBER_FILTER = where("role", "==", "member");

// 로그인 상태 유지(Local)
await setPersistence(auth, browserLocalPersistence);

/* =========================
   DOM 유틸 & 토스트
   ========================= */
const $  = (sel, ctx=document) => ctx.querySelector(sel);
const $$ = (sel, ctx=document) => Array.from(ctx.querySelectorAll(sel));

document.body.dataset.auth = "out";

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
   정지 계정 가드 (공용)
   ========================= */
// user가 null이면 로그인 페이지로 보내고,
// disabled === true면 팝업 + 로그아웃 + 리다이렉트 후 null 반환.
// 정상 계정이면 Firestore user 데이터 반환.
async function guardActiveUser(user) {
  if (!user) {
    // 로그인 안 되어 있으면 index로
    location.href = "index.html";
    return null;
  }

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    const data = snap.exists() ? snap.data() : {};

    // ✅ users 문서가 없으면: 강퇴/탈퇴 가능성 → 사유 안내 후 로그아웃
    if (!snap.exists()) {
      let reason = "";
      try {
        const wSnap = await getDoc(doc(db, "withdrawn_users", user.uid));
        if (wSnap.exists()) {
          reason = (wSnap.data()?.reason || "").trim();
        }
      } catch {}

      alert(
        "강퇴(회원탈퇴) 처리된 계정입니다.\n\n" +
        (reason ? `사유: ${reason}\n\n` : "") +
        "재가입 후 이용해 주세요."
      );

      try {
        await signOut(auth);
      } catch {}

      location.href = "index.html";
      return null;
    }


    if (data.disabled === true) {
      alert("계정이 정지되었습니다. 관리자에게 문의해주세요.");

      try {
        await signOut(auth);
        notify("정지된 계정입니다. 로그아웃되었습니다.");
      } catch (e) {
        console.error("signOut 실패:", e);
      }

      // 홈이나 로그인 페이지로 돌려보냄
      location.href = "index.html";
      return null;
    }

    return data; // 정상 계정이면 user 데이터 반환
  } catch (e) {
    console.error("guardActiveUser 오류:", e);
    notify("계정 상태 확인 중 오류가 발생했습니다.");
    // 안전하게 로그아웃 처리해도 되고, 그냥 머물러도 됨. 여기선 머무름.
    return null;
  }
}


/* =========================
   로그아웃 UI 강제 잠금
   ========================= */
function forceLoggedOutUI(){
  $("#groups")?.setAttribute("aria-hidden", "true");
  $("#groupsNotice")?.setAttribute("aria-hidden", "true");
  $(".page-actions")?.setAttribute("aria-hidden", "true");
}
forceLoggedOutUI();

/* =========================
   외부 링크 로딩 (config/links.json)
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

/* =========================
   안전한 링크 오픈
   ========================= */
function openLink(link, { newTab = true } = {}) {
  if (!link || link === "#") return;
  try {
    if (newTab) {
      const a = document.createElement("a");
      a.href = link;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } else {
      window.location.href = link;
    }
  } catch (err) {
    console.error("openLink 실패:", err);
    window.location.href = link; // fallback
  }
}

/* =========================
   상단 총원 카운트(있으면만 사용)
   ========================= */
const LIMIT_TOTAL = 20;
let __countReqId = 0;
let __refreshTimer = null;

function setCountText(el, val, limit = LIMIT_TOTAL){
  if(!el) return;
  const n = Math.min(val, limit);
  el.textContent = String(n);
  el.style.color = (val >= limit) ? "#ff4d4d" : "#66d1ff";
}

async function refreshCounts(){
  try{
    // 상단 카운트 DOM이 없는 페이지면 스킵
    const need = $("#c1") || $("#c2") || $("#c3");
    if(!need) return;

    const usersRef = collection(db, "users");
    const reqId = ++__countReqId;

    const [campSnap, boardSnap, sportSnap] = await Promise.all([
      getCountFromServer(query(usersRef, where("groups.camp",  "==", true), ROLE_MEMBER_FILTER)),
      getCountFromServer(query(usersRef, where("groups.board", "==", true), ROLE_MEMBER_FILTER)),
      getCountFromServer(query(usersRef, where("groups.sport", "==", true), ROLE_MEMBER_FILTER)),
    ]);

    if(reqId !== __countReqId) return;

    const camp  = campSnap.data().count  ?? 0;
    const board = boardSnap.data().count ?? 0;
    const sport = sportSnap.data().count ?? 0;

    setCountText($("#c1"), camp);
    setCountText($("#c2"), board);
    setCountText($("#c3"), sport);
    $("#d1") && ($("#d1").textContent = "/20");
    $("#d2") && ($("#d2").textContent = "/20");
    $("#d3") && ($("#d3").textContent = "/20");
  }catch(err){
    console.error("[refreshCounts] failed:", err);
  }
}
function refreshCountsDebounced(){
  clearTimeout(__refreshTimer);
  __refreshTimer = setTimeout(()=>refreshCounts(), 60);
}
document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="visible") refreshCountsDebounced(); });
window.addEventListener("online", ()=> refreshCountsDebounced());

/* =========================
   성별 카운트(칩) — 카드 내부 표시
   ========================= */
const LIMIT_GENDER = 10;   // 캠핑/보드/운동: 남 10 / 여 10
let __gReqId = 0;

// 성별 정원 체크: 그룹(key)과 성별("남"/"여")을 받아 현재 인원이 정원 이상인지 반환
async function isGenderFull(groupKey, gender){
  if(groupKey === "free" || !gender) return false; // 자유는 정원 없음 / 성별 미기입시는 패스
  try{
    const usersRef = collection(db, "users");
    const snap = await getCountFromServer(
      query(
        usersRef,
        where(`groups.${groupKey}`, "==", true),
        ROLE_MEMBER_FILTER,
        where("gender", "==", gender)
      )
    );

    const n = snap.data().count || 0;
    return n >= LIMIT_GENDER; // 정원 10명
  }catch(e){
    console.error("[isGenderFull] failed:", e);
    return false; // 장애 시 막지 않고 진행
  }
}

function setChip(el, label, n, limit = LIMIT_GENDER){
  if(!el) return;
  el.innerHTML = `<span class="lbl">${label}</span><span class="val">${n}/${limit}</span>`;
  el.classList.toggle("full", n >= limit); // 꽉차면 빨강 강조(css .chip.full)
}
function setChipFree(el, label, n){
  if(!el) return;
  el.innerHTML = `<span class="lbl">${label}</span><span class="val">${n}명</span>`;
  el.classList.remove("full"); // 자유는 정원 없음 → 항상 풀표시 해제
}

async function refreshCountsGender(){
  try{
    const usersRef = collection(db, "users");
    const reqId = ++__gReqId;

    // 남/여 × (캠핑/보드/운동/자유)
    const [
      campM,  campF,
      boardM, boardF,
      sportM, sportF,
      freeM,  freeF
    ] = await Promise.all([
      getCountFromServer(query(usersRef, where("groups.camp",  "==", true), ROLE_MEMBER_FILTER, where("gender","==","남"))),
      getCountFromServer(query(usersRef, where("groups.camp",  "==", true), ROLE_MEMBER_FILTER, where("gender","==","여"))),
      getCountFromServer(query(usersRef, where("groups.board", "==", true), ROLE_MEMBER_FILTER, where("gender","==","남"))),
      getCountFromServer(query(usersRef, where("groups.board", "==", true), ROLE_MEMBER_FILTER, where("gender","==","여"))),
      getCountFromServer(query(usersRef, where("groups.sport", "==", true), ROLE_MEMBER_FILTER, where("gender","==","남"))),
      getCountFromServer(query(usersRef, where("groups.sport", "==", true), ROLE_MEMBER_FILTER, where("gender","==","여"))),
      getCountFromServer(query(usersRef, where("groups.free",  "==", true), ROLE_MEMBER_FILTER, where("gender","==","남"))),
      getCountFromServer(query(usersRef, where("groups.free",  "==", true), ROLE_MEMBER_FILTER, where("gender","==","여"))),
    ]);

    if(reqId !== __gReqId) return;

    const cM = campM.data().count  || 0;
    const cF = campF.data().count  || 0;
    const bM = boardM.data().count || 0;
    const bF = boardF.data().count || 0;
    const sM = sportM.data().count || 0;
    const sF = sportF.data().count || 0;
    const fM = freeM.data().count  || 0;
    const fF = freeF.data().count  || 0;

    // 카드 칩 채우기(캠/보/운: 정원 10, 자유: 정원 없음)
    setChip(document.getElementById("chip-camp-m"),  "남", cM);
    setChip(document.getElementById("chip-camp-f"),  "여", cF);
    setChip(document.getElementById("chip-board-m"), "남", bM);
    setChip(document.getElementById("chip-board-f"), "여", bF);
    setChip(document.getElementById("chip-sport-m"), "남", sM);
    setChip(document.getElementById("chip-sport-f"), "여", sF);

    setChipFree(document.getElementById("chip-free-m"), "남", fM);
    setChipFree(document.getElementById("chip-free-f"), "여", fF);

  }catch(err){
    console.error("[refreshCountsGender] failed:", err);
  }
}

/* =========================
   그룹 집합 변환
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
   그룹 카드 렌더 (남/여 칩 포함: 자유까지)
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

    const link = GROUP_LINKS[it.key] || "#";

    // 자유에도 칩 추가 (표기만 n명, full 강조 없음)
    const chips = `
      <div class="gender-chips" aria-label="${it.title} 성별 인원">
        <span id="chip-${it.key}-m" class="chip male"><span class="lbl">남</span><span class="val">0${it.key==="free" ? "명" : "/10"}</span></span>
        <span id="chip-${it.key}-f" class="chip female"><span class="lbl">여</span><span class="val">0${it.key==="free" ? "명" : "/10"}</span></span>
      </div>
    `;

    const actions = joined
      ? `
        <a class="info-btn" href="guide.html?group=${it.key}" data-key="${it.key}">안내</a>
        <a class="group-btn move-btn" href="${link}" target="_blank" rel="noopener">이동하기</a>
        <button class="group-btn withdraw-btn" data-key="${it.key}">탈퇴하기</button>
      `
      : `
        <a class="info-btn" href="guide.html?group=${it.key}" data-key="${it.key}">안내</a>
        <button class="group-btn" data-key="${it.key}">참가하기</button>
      `;

    return `
      <article class="group-card" data-key="${it.key}" data-joined="${joined ? "true":"false"}">
        <a href="${link}" target="_blank" rel="noopener" title="${it.title}">
          <img class="group-thumb" src="${it.img}" alt="${it.title}" onerror="this.style.display='none'">
        </a>
        <div class="group-body">
          <h3 class="group-title">
            ${it.title}
          </h3>

          ${chips}

          <div class="group-actions">
            <span class="group-status" data-status>${joined ? "참가중" : "미참가"}</span>
            ${actions}
          </div>
        </div>
      </article>
    `;
  }).join("");

  bindGroupButtons();
}

/* =========================
   그룹 버튼 바인딩 (참가/탈퇴/이동)
   ========================= */
function bindGroupButtons(){
  const groupsEl = document.getElementById("groups");
  if(!groupsEl) return;

  // 썸네일 이동 막기
  document.querySelectorAll(".group-card > a").forEach(a=>{
    a.addEventListener("click", (e)=>{
      e.preventDefault();
      e.stopPropagation();
      return false;
    });
    a.setAttribute("aria-disabled", "true");
    a.style.cursor = "default";
    a.style.pointerEvents = "none";
  });

  groupsEl.querySelectorAll(".group-actions .info-btn, .group-actions .group-btn").forEach(btn=>{
    btn.addEventListener("click", async (e)=>{
      const isLinkBtn = btn.matches("a.group-btn.move-btn");
      if(isLinkBtn){
        e.preventDefault();
        const link = btn.getAttribute("href");
        if(link && link !== "#") openLink(link, { newTab: true });
        return;
      }

      // 참가/탈퇴/안내
      if(btn.matches(".info-btn")) return;

      e.preventDefault();
      const key  = btn.dataset.key;
      const card = btn.closest(".group-card");
      if(!key || !card) return;

      const titleMap = { camp:"캠핑", board:"보드게임", sport:"운동", free:"자유" };
      const title    = titleMap[key];
      const linkHref = GROUP_LINKS[key] || "#";

      const isWithdraw = btn.classList.contains("withdraw-btn");
      const willJoin   = !isWithdraw;

      // ---- '자유' 참가 전 조건: 캠/보/운 중 1개 이상 가입되어 있어야 함 ----
      if (willJoin && key === "free") {
        const hasOne = Array.from(groupsEl.querySelectorAll(".group-card")).some(el => {
          const k = el.dataset.key;
          return (k === "camp" || k === "board" || k === "sport") && el.getAttribute("data-joined") === "true";
        });
        if (!hasOne) {
          notify("캠핑/보드게임/운동 중 1개 이상 먼저 가입한 뒤 자유 모임에 참가할 수 있어요.");
          return; // 참가 처리 중단
        }
      }

      // camp/board/sport 최소 1개 유지
      if(!willJoin && (key==="camp"||key==="board"||key==="sport")){
        const joinedOthers = Array.from(groupsEl.querySelectorAll(".group-card")).some(cardEl=>{
          const k = cardEl.dataset.key;
          if(k===key) return false;
          if(!(k==="camp"||k==="board"||k==="sport")) return false;
          return cardEl.getAttribute("data-joined") === "true";
        });
        if(!joinedOthers){
          notify("캠핑/보드게임/운동 중 최소 1개는 선택되어 있어야 합니다.");
          return;
        }
      }

      // ---- 성별 정원 체크 (join 시) ----
      if (willJoin) {
        const myGender = window.__userGender; // "남" 또는 "여"
        if (key === "camp" || key === "board" || key === "sport") {
          const full = await isGenderFull(key, myGender);
          if (full) {
            notify(`${title}의 ${myGender ?? ""} 정원이 마감되었습니다.`);
            return; // 참가 처리 중단 (UI 변경 없음)
          }
        }
      }

      // ===== UI 즉시 반영
      const statusBadge = card.querySelector(".badge.status");
      const statusSpan  = card.querySelector("[data-status]");
      const actionsEl   = card.querySelector(".group-actions");

      if(willJoin){
        card.setAttribute("data-joined", "true");
        statusBadge?.classList.remove("none");
        if(statusBadge) statusBadge.textContent = "참가중";
        if(statusSpan)  statusSpan.textContent  = "참가중";

        // 참가하기 → 탈퇴하기
        const withdrawBtn = document.createElement("button");
        withdrawBtn.className = "group-btn withdraw-btn";
        withdrawBtn.dataset.key = key;
        withdrawBtn.textContent = "탈퇴하기";
        btn.replaceWith(withdrawBtn);

        // 이동하기 없으면 추가
        if(!actionsEl.querySelector(".move-btn")){
          const moveA = document.createElement("a");
          moveA.className = "group-btn move-btn";
          moveA.href = linkHref;
          moveA.target = "_blank";
          moveA.rel = "noopener";
          moveA.textContent = "이동하기";
          const withdrawRef = actionsEl.querySelector(".withdraw-btn");
          if(withdrawRef) actionsEl.insertBefore(moveA, withdrawRef);
          else actionsEl.appendChild(moveA);
        }

        notify(`${title} 참가되었습니다.`);
      }else{
        card.setAttribute("data-joined", "false");
        statusBadge?.classList.add("none");
        if(statusBadge) statusBadge.textContent = "미참가";
        if(statusSpan)  statusSpan.textContent  = "미참가";

        // 이동하기 제거
        actionsEl.querySelector(".move-btn")?.remove();

        // 탈퇴하기 → 참가하기
        const joinBtn = document.createElement("button");
        joinBtn.className = "group-btn";
        joinBtn.dataset.key = key;
        joinBtn.textContent = "참가하기";
        btn.replaceWith(joinBtn);

        notify(`${title}에서 탈퇴했습니다.`);
      }

      // 새 버튼도 다시 바인딩
      bindGroupButtons();

      // ===== DB 반영 + 카운트 갱신
      try{
        await window.toggleGroup?.(key, willJoin);
        refreshCounts();        // 상단 총원(있으면)
        refreshCountsGender();  // 칩들

        if (willJoin && linkHref && linkHref !== "#") {
          openLink(linkHref, { newTab: true });
        }
        
      }catch(err){
        console.error("toggleGroup failed:", err);
        refreshCounts();
        refreshCountsGender();
      }
    });
  });
}

/* =========================
   헤더 (권한별)
   ========================= */
function setHeaderForRole(role){
  const btnRow = document.querySelector(".btn-row");
  if(!btnRow) return;
  const isAdmin = role === "manager" || role === "master";
  btnRow.innerHTML = `
    <a id="noticeBtn" class="btn primary" href="notice.html">공지사항</a>
    <a id="albumBtn" class="btn primary" href="gallery.html">사진첩</a>
    ${isAdmin ? `<a id="manageBtn" class="btn" href="members.html">회원관리</a>` : ``}
    <a id="qaBtn" class="btn kakao" href="https://open.kakao.com/o/s24gqv1h" target="_blank" rel="noopener">1:1 문의</a>
    <button id="profileBtn" class="btn ghost" type="button">정보 수정</button>
    <button id="logoutBtn" class="btn ghost" type="button">로그아웃</button>
  `;


  $("#logoutBtn")?.addEventListener("click", async ()=>{
    try{ await signOut(auth); notify("로그아웃되었습니다."); }
    catch(e){ console.error(e); notify("로그아웃 실패"); }
  });

  
  bindProfileModalOnce();
  $("#profileBtn")?.addEventListener("click", openProfileModal);
}

/* =========================
   정보 수정(프로필) 모달
   ========================= */
function openModal(id){
  const m = document.getElementById(id);
  if(!m) return;
  m.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}
function closeModal(id){
  const m = document.getElementById(id);
  if(!m) return;
  m.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function normalizePhone(v){
  const s = String(v || "").trim();
  const d = s.replace(/\D/g, "");
  if(d.length === 11) return d.replace(/(\d{3})(\d{4})(\d{4})/, "$1-$2-$3");
  if(d.length === 10) return d.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3");
  return s;
}

async function openProfileModal(){
  const user = auth.currentUser;
  if(!user){ notify("로그인이 필요합니다."); location.href="index.html"; return; }

  try{
    const snap = await getDoc(doc(db, "users", user.uid));
    if(!snap.exists()){ notify("회원 정보를 찾을 수 없습니다."); return; }
    const u = snap.data() || {};

    // 값 채우기
    $("#pfName").value      = u.name || user.displayName || "";
    $("#pfBirthYear").value = u.birthYear || "";
    $("#pfRegion").value    = u.region || "";
    $("#pfPhone").value     = u.phone || "";

    openModal("profileModal");
  }catch(e){
    console.error(e);
    notify("정보를 불러오지 못했습니다.");
  }
}

async function saveProfile(){
  const user = auth.currentUser;
  if(!user) return;

  const name      = $("#pfName").value.trim();
  const birthYear = String($("#pfBirthYear").value || "").trim();
  const region    = $("#pfRegion").value.trim();
  const phone     = normalizePhone($("#pfPhone").value);

  // 최소 검증
  if(!name){ notify("이름을 입력해 주세요."); return; }
  if(birthYear && !/^\d{4}$/.test(birthYear)){ notify("출생년도는 4자리로 입력해 주세요."); return; }

  try{
    // users 문서 업데이트 (성별/모임참가 수정 없음)
    await updateDoc(doc(db, "users", user.uid), {
      name,
      birthYear: birthYear ? Number(birthYear) : null,
      region,
      phone,
      updatedAt: serverTimestamp(),
    });

    // Auth displayName도 같이 갱신(선택)
    try{ await updateProfile(user, { displayName: name }); } catch {}

    // home 화면에 즉시 반영
    const subtitle = document.querySelector(".subtitle");
    if(subtitle) subtitle.textContent = `${name}님, 포니버스에 오신 것을 환영합니다`;

    closeModal("profileModal");
    notify("정보가 저장되었습니다.");

    // 모임/칩은 안 건드리지만, 혹시 표시 갱신 원하면 카운트만 새로고침
    refreshCounts();
    refreshCountsGender();
  }catch(e){
    console.error(e);
    notify("저장 실패(권한/규칙 확인)");
  }
}


// 모달 이벤트 바인딩 (한 번만)
function bindProfileModalOnce(){
  if(window.__profileModalBound) return;
  window.__profileModalBound = true;

  $("#profileCloseBtn")?.addEventListener("click", ()=> closeModal("profileModal"));
  $("#profileCancelBtn")?.addEventListener("click", ()=> closeModal("profileModal"));
  $("#profileSaveBtn")?.addEventListener("click", saveProfile);

  const modal = $("#profileModal");
  modal?.addEventListener("click", (e)=>{
    if(e.target === modal) closeModal("profileModal");
  });

  document.addEventListener("keydown", (e)=>{
    if(e.key === "Escape" && $("#profileModal")?.getAttribute("aria-hidden") === "false"){
      closeModal("profileModal");
    }
  });
}


/* =========================
   전역: 그룹 토글(DB 반영)
   ========================= */
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

/* =========================
   Auth 상태 관찰
   ========================= */
/* =========================
   Auth 상태 관찰 (+ 정지 계정 가드)
   ========================= */
onAuthStateChanged(auth, async (user) => {
  // 🔒 로그인/정지 상태 공통 체크
  const data = await guardActiveUser(user);
  if (!data) {
    // guardActiveUser에서 이미 리다이렉트/로그아웃 처리했으므로 여기서 종료
    return;
  }

  document.body.dataset.auth = "in";

  try {
    await loadGroupLinks();

    const role = data?.role || "member";
    setHeaderForRole(role);

    // 현재 사용자 성별 전역 저장 (참가 시 정원 체크용)
    window.__userGender = data?.gender || null;

    const joinedSet = groupsToSet(data?.groups);
    const subtitle = document.querySelector(".subtitle");
    const name =
      data?.name ||
      user.displayName ||
      (user.email?.split("@")[0] ?? "회원");
    if (subtitle)
      subtitle.textContent = `${name}님, 포니버스에 오신 것을 환영합니다`;

    renderGroups(joinedSet);

    // 렌더 직후 칩/카운트 갱신
    await Promise.resolve();
    refreshCounts();        // 상단 총원(있으면)
    refreshCountsGender();  // 카드 칩(자유 포함)

  } catch (err) {
    console.error("load user failed:", err);
    setHeaderForRole("member");
    renderGroups(new Set());
    refreshCounts();
    refreshCountsGender();
  }

  $("#groups")?.setAttribute("aria-hidden", "false");
  $("#groupsNotice")?.setAttribute("aria-hidden", "false");
  $(".page-actions")?.setAttribute("aria-hidden", "false");
  if ($("#groupsNotice")) {
    $("#groupsNotice").textContent =
      "원활한 회원 관리를 위해 실제로 참여 중인 모임에만 ‘참가하기’ 버튼을 눌러 주세요.";
  }
});


/* =========================
   회원 탈퇴(계정 삭제)
   ========================= */
$("#withdrawBtn")?.addEventListener("click", async ()=>{
  const user = auth.currentUser;
  if(!user){ notify("로그인 상태가 아닙니다."); return; }
  if(!confirm("정말 계정을 삭제하시겠습니까? 복구할 수 없습니다.")) return;

  try{
    await deleteDoc(doc(db, "users", user.uid)); // Firestore 문서 삭제
    await deleteUser(user);                      // Auth 계정 삭제
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
