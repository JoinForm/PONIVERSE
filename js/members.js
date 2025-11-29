// js/members.js — 회원관리(검색/미참석자/출석/권한/비활성화 토글/리셋)
// - 자유 모임은 출석 대상에서 제외 (테이블 칸도 제거)
// - 메인 모임(camp/board/sport)별 미참석자 필터
// - 메인 모임별 참석률 리셋 (캠핑/보드게임/운동)

/* ============ Firebase ============ */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import {
  getFirestore, collection, getDocs, getDoc, doc, updateDoc,
  serverTimestamp, writeBatch
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

// 일부 환경에서 top-level await 문제가 있어 then/catch 사용
setPersistence(auth, browserLocalPersistence).catch(() => {});

/* ============ helpers ============ */
const $ = (s, c = document) => c.querySelector(s);

function notify(msg) {
  let t = $("#toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 1800);
}

function fmtDate(ts) {
  try {
    const d = ts && typeof ts.toDate === "function" ? ts.toDate()
            : (ts instanceof Date ? ts : null);
    return d ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(d) : "";
  } catch {
    return "";
  }
}

function escapeHtml(s) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" };
  return String(s == null ? "" : s).replace(/[&<>"]/g, m => map[m]);
}

function sel(v, k) {
  return String(v || "").toLowerCase() === String(k) ? " selected" : "";
}

function cb(uid, key, checked) {
  return (
    '<input type="checkbox" class="att-cb" data-uid="' + uid +
    '" data-key="' + key + '" ' + (checked ? "checked" : "") + "/>"
  );
}

function getIdPart(u) {
  const base = u.username || u.email || "";
  return base.split("@")[0] || "";
}

/* === 출석/가입 관련 유틸 === */
function isJoined(u, key) {
  const g = u.groups || {};
  const v = g[key];
  return v === true || v === "true" || v === 1;
}

function isAttended(u, key) {
  const a = u.attendance || {};
  return !!a[key];
}

/* === 정렬 유틸: role 우선(master→manager→member), 같은 권한은 가입일 오래된 순 === */
const ROLE_RANK = { master: 0, manager: 1, member: 2 };

function getJoinedAtMs(u) {
  const t = u?.createdAt || u?.created_at;
  if (!t) return Number.MAX_SAFE_INTEGER;
  if (typeof t?.toMillis === "function") return t.toMillis();
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
}

function sortUsersByRoleThenJoined(arr) {
  arr.sort((a, b) => {
    const ra = ROLE_RANK[(a?.role || "member").toLowerCase()] ?? 3;
    const rb = ROLE_RANK[(b?.role || "member").toLowerCase()] ?? 3;
    if (ra !== rb) return ra - rb;            // 권한 우선
    const ja = getJoinedAtMs(a);
    const jb = getJoinedAtMs(b);
    if (ja !== jb) return ja - jb;            // 오래된 가입 먼저
    return (a?.name || "").localeCompare(b?.name || "", "ko");
  });
  return arr;
}

/* ============ 권한/페이지 진입 ============ */
let ME = null;
let IS_MANAGER = false;
let IS_MASTER  = false;

onAuthStateChanged(auth, async (user) => {
  if (!user) { location.href = "index.html"; return; }

  try {
    const meSnap = await getDoc(doc(db, "users", user.uid));
    ME = { id: user.uid, ...(meSnap.exists() ? meSnap.data() : {}) };

    const myRole = String(ME.role || "member").toLowerCase();
    IS_MASTER  = myRole === "master";
    IS_MANAGER = IS_MASTER || myRole === "manager";

    if (!IS_MASTER) document.body.classList.add("non-master");

    if (!IS_MANAGER) {
      notify("접근 권한이 없습니다.");
      setTimeout(() => (location.href = "home.html"), 900);
      return;
    }

    // 🔓 참석률 리셋 버튼: manager / master 둘 다 사용 가능
    if (!IS_MANAGER) {
      $("#btnResetAttendance")?.setAttribute("disabled", "disabled");
      $("#btnResetCamp")?.setAttribute("disabled", "disabled");
      $("#btnResetBoard")?.setAttribute("disabled", "disabled");
      $("#btnResetSport")?.setAttribute("disabled", "disabled");
    } else {
      $("#btnResetAttendance")?.removeAttribute("disabled");
      $("#btnResetCamp")?.removeAttribute("disabled");
      $("#btnResetBoard")?.removeAttribute("disabled");
      $("#btnResetSport")?.removeAttribute("disabled");
    }

    await loadMembers();
    bindControls();
  } catch (e) {
    console.error(e);
    notify("프로필 로드 중 오류");
  }
});

/* ============ 캐시 & 필터 ============ */
let CACHE = []; // 전체 회원 캐시(화면 변경 내용 포함)

function matchesTerm(u, term) {
  if (!term) return true;
  const t = term.toLowerCase();
  return (
    getIdPart(u).toLowerCase().includes(t) ||
    String(u.name || "").toLowerCase().includes(t) ||
    String(u.region || "").toLowerCase().includes(t) ||
    String(u.phone || "").toLowerCase().includes(t)
  );
}

/**
 * 메인 모임별 미참석자 필터
 * - key: "camp" | "board" | "sport"
 * - 해당 모임에 가입했으나 출석이 한 번도 안 찍힌 유저
 */
function isAbsentInGroup(u, key) {
  if (!(key === "camp" || key === "board" || key === "sport")) return false;
  if (!isJoined(u, key)) return false;
  return !isAttended(u, key);
}

function applyFiltersAndRender() {
  const term          = ($("#searchInput")?.value || "").trim();
  const onlyDisabled  = $("#onlyDisabled")?.checked;
  const onlyAbsent    = $("#onlyNeverAttended")?.checked; // "미참석자만"
  const absentGroup   = ($("#absentFilter")?.value || "").trim(); // camp/board/sport

  let list = CACHE.filter(u => matchesTerm(u, term));

  if (onlyDisabled) {
    list = list.filter(u => !!u.disabled);
  }

  // 메인 모임별 미참석자 필터
  if (onlyAbsent && (absentGroup === "camp" || absentGroup === "board" || absentGroup === "sport")) {
    list = list.filter(u => isAbsentInGroup(u, absentGroup));
  }

  sortUsersByRoleThenJoined(list);
  renderTable(list);
}

/* ============ 데이터 로드/렌더 ============ */
async function loadMembers() {
  const body = $("#membersBody");
  if (body) body.innerHTML = '<tr><td colspan="10">로딩 중…</td></tr>'; // 10컬럼

  const qSnap = await getDocs(collection(db, "users"));
  const rows = [];
  qSnap.forEach(d => rows.push({ id: d.id, ...d.data() }));
  sortUsersByRoleThenJoined(rows);

  CACHE = rows;
  applyFiltersAndRender();
}

function renderTable(rows) {
  const tbody = document.createElement("tbody");
  tbody.id = "membersBody";
  for (const u of rows) tbody.appendChild(renderRow(u));
  $("#membersBody")?.replaceWith(tbody);
}

function renderRow(u) {
  const tr = document.createElement("tr");
  tr.dataset.uid = u.id;

  const joined = {
    camp:  isJoined(u, "camp"),
    board: isJoined(u, "board"),
    sport: isJoined(u, "sport"),
    free:  isJoined(u, "free")
  };
  const att = u.attendance || {};
  const isDisabled = !!u.disabled;
  const isMe = u.id === auth.currentUser?.uid;

  const td = (cls, html) => {
    const x = document.createElement("td");
    if (cls) x.className = cls;
    x.innerHTML = html;
    return x;
  };

  tr.appendChild(td("col-name",  escapeHtml(u.name || "-")));
  tr.appendChild(td("col-gy",    escapeHtml((u.gender || "-") + "/" + (u.birthYear || "-"))));
  tr.appendChild(td("col-phone", escapeHtml(u.phone || "-")));
  tr.appendChild(td("col-region", escapeHtml(u.region || "-")));

  // 권한 셀 (+ 비활성화 표시)
  tr.appendChild(td("col-role", IS_MASTER
    ? (
      '<select class="sel-role" data-uid="' + u.id + '"' + (isDisabled ? ' disabled' : '') + '>' +
        '<option value="member"'  + sel(u.role, "member")  + '>member</option>' +
        '<option value="manager"' + sel(u.role, "manager") + '>manager</option>' +
        '<option value="master"'  + sel(u.role, "master")  + '>master</option>' +
      "</select>" +
      (isDisabled ? '<div style="margin-top:4px;font-size:11px;color:#ff9b9b;">(비활성화)</div>' : "")
    )
    : escapeHtml((u.role || "member") + (isDisabled ? " (비활성)" : ""))
  ));

  // 출석 체크: 메인 모임(camp/board/sport)만
  tr.appendChild(td("col-att", joined.camp  ? cb(u.id, "camp",  !!att.camp)  : "–"));
  tr.appendChild(td("col-att", joined.board ? cb(u.id, "board", !!att.board) : "–"));
  tr.appendChild(td("col-att", joined.sport ? cb(u.id, "sport", !!att.sport) : "–"));

  const created = u.createdAt || u.created_at || null;
  tr.appendChild(td("col-created", created ? escapeHtml(fmtDate(created)) : "-"));

  const btnLabel = isDisabled ? "활성화" : "비활성화";
  const btnDisabledAttr = isMe ? " disabled" : "";

  tr.appendChild(td("col-ops",
    '<button class="btn danger btn-kick" data-uid="' + u.id + '"' +
    btnDisabledAttr + ">" + btnLabel + "</button>"
  ));

  if (isDisabled) {
    tr.style.opacity = 0.6;
  }

  // 권한 변경
  tr.querySelectorAll(".sel-role").forEach(selEl => {
    selEl.addEventListener("change", async () => {
      const uid = selEl.dataset.uid;
      try {
        await updateDoc(doc(db, "users", uid), { role: selEl.value, updatedAt: serverTimestamp() });
        const i = CACHE.findIndex(x => x.id === uid);
        if (i >= 0) CACHE[i] = { ...CACHE[i], role: selEl.value };
        notify("권한 변경됨");
        if (uid === auth.currentUser?.uid) setTimeout(() => location.reload(), 400);
      } catch (e) {
        console.error(e);
        notify("권한 변경 실패");
      }
    });
  });

  // 출석 토글 (캠/보/운만)
  tr.querySelectorAll(".att-cb").forEach(cbEl => {
    cbEl.addEventListener("change", async () => {
      const uid  = cbEl.dataset.uid;
      const key  = cbEl.dataset.key; // camp/board/sport
      const next = cbEl.checked;
      try {
        await updateDoc(doc(db, "users", uid), {
          ["attendance." + key]: next,
          updatedAt: serverTimestamp()
        });
        const idx = CACHE.findIndex(x => x.id === uid);
        if (idx >= 0) {
          const a = { ...(CACHE[idx].attendance || {}) };
          a[key] = next;
          CACHE[idx] = { ...CACHE[idx], attendance: a };
        }
        notify("출석 상태 저장됨");
      } catch (e) {
        console.error(e);
        notify("저장 실패");
        cbEl.checked = !next;
      }
    });
  });

    // 비활성화/활성화 토글
  const toggleBtn = tr.querySelector(".btn-kick");
  toggleBtn?.addEventListener("click", async () => {
    if (toggleBtn.disabled) return;

    const uid = toggleBtn.dataset.uid;
    const idx = CACHE.findIndex(x => x.id === uid);
    if (idx < 0) return;

    const currDisabled = !!CACHE[idx].disabled;
    const nextDisabled = !currDisabled;

    const confirmMsg = nextDisabled
      ? "해당 계정을 '비활성화' 하시겠습니까?\n\n※ 계정은 삭제되지 않고, 로그인 및 사용이 제한됩니다."
      : "해당 계정을 다시 '활성화' 하시겠습니까?";

    if (!confirm(confirmMsg)) return;

    try {
      await updateDoc(doc(db, "users", uid), {
        disabled: nextDisabled,
        disabledAt: nextDisabled ? serverTimestamp() : null,
        updatedAt: serverTimestamp()
      });

      // 캐시 갱신
      CACHE[idx] = { ...CACHE[idx], disabled: nextDisabled };

      // 버튼 텍스트 변경
      toggleBtn.textContent = nextDisabled ? "활성화" : "비활성화";

      // 행 배경/투명도 변경
      tr.style.opacity = nextDisabled ? 0.6 : "";

      // 출석 체크박스 활성/비활성
      tr.querySelectorAll(".att-cb").forEach(cbEl => {
        cbEl.disabled = nextDisabled;
      });

      // 권한 셀 내용/상태 변경
      const roleTd = tr.querySelector(".col-role");
      if (roleTd) {
        if (IS_MASTER) {
          const selEl = roleTd.querySelector(".sel-role");
          if (selEl) {
            if (nextDisabled) {
              selEl.setAttribute("disabled", "disabled");
            } else {
              selEl.removeAttribute("disabled");
            }
          }

          // (비활성화) 라벨 추가/제거
          let label = roleTd.querySelector(".disabled-label");
          if (nextDisabled) {
            if (!label) {
              label = document.createElement("div");
              label.className = "disabled-label";
              label.style.marginTop = "4px";
              label.style.fontSize = "11px";
              label.style.color = "#ff9b9b";
              label.textContent = "(비활성화)";
              roleTd.appendChild(label);
            }
          } else if (label) {
            label.remove();
          }
        } else {
          // 매니저 화면: 단순 텍스트만 바꿔 줌
          const roleText = (CACHE[idx].role || "member") + (nextDisabled ? " (비활성)" : "");
          roleTd.textContent = roleText;
        }
      }

      notify(nextDisabled ? "계정이 비활성화되었습니다." : "계정이 활성화되었습니다.");
    } catch (e) {
      console.error(e);
      notify("비활성화/활성화 처리 실패");
    }
  });


  // 🔒 비활성화된 유저는 권한/출석 입력 막기
  if (isDisabled) {
    // 출석 체크박스 비활성화
    tr.querySelectorAll(".att-cb").forEach(cbEl => {
      cbEl.disabled = true;
    });

    // 권한 셀렉트 비활성화 (master 화면 전용)
    const roleSelEl = tr.querySelector(".sel-role");
    if (roleSelEl) {
      roleSelEl.disabled = true;
    }
  }

  return tr;
}

/* ============ 참석률 리셋: 메인 모임별 ============ */
async function resetAttendance(groupKey) {
  if (!IS_MANAGER) {
    notify("매니저 이상만 가능합니다.");
    return;
  }

  // groupKey: "camp" | "board" | "sport" | "all"
  const labels = {
    camp: "캠핑",
    board: "보드게임",
    sport: "운동",
    all: "캠핑/보드게임/운동 전체"
  };

  let targetFields;
  let key = groupKey;

  if (key === "camp" || key === "board" || key === "sport") {
    targetFields = [key];
  } else {
    key = "all";
    targetFields = ["camp", "board", "sport"];
  }

  const msg = `전 회원의 ${labels[key]} 참석 상태를 ‘미참석’으로 초기화합니다.\n\n진행하시겠습니까?`;
  if (!confirm(msg)) return;

  try {
    const snap = await getDocs(collection(db, "users"));
    const batch = writeBatch(db);

    snap.forEach(d => {
      const upd = { updatedAt: serverTimestamp() };
      targetFields.forEach(f => {
        upd[`attendance.${f}`] = false;
      });
      batch.update(doc(db, "users", d.id), upd);
    });

    await batch.commit();

    CACHE = CACHE.map(u => {
      const a = { ...(u.attendance || {}) };
      targetFields.forEach(f => { a[f] = false; });
      return { ...u, attendance: a };
    });

    applyFiltersAndRender();
    notify("초기화 완료");
  } catch (e) {
    console.error(e);
    notify("초기화 실패");
  }
}

/* ============ 컨트롤 ============ */
function bindControls() {
  $("#searchInput")?.addEventListener("input", applyFiltersAndRender);

  $("#onlyNeverAttended")?.addEventListener("change", applyFiltersAndRender);
  $("#absentFilter")?.addEventListener("change", applyFiltersAndRender);

  $("#onlyDisabled")?.addEventListener("change", applyFiltersAndRender);

  $("#refreshBtn")?.addEventListener("click", () => loadMembers());
  $("#refreshBtn2")?.addEventListener("click", () => loadMembers());

  $("#btnResetAttendance")?.addEventListener("click", () => resetAttendance("all"));
  $("#btnResetCamp")?.addEventListener("click", () => resetAttendance("camp"));
  $("#btnResetBoard")?.addEventListener("click", () => resetAttendance("board"));
  $("#btnResetSport")?.addEventListener("click", () => resetAttendance("sport"));
}

