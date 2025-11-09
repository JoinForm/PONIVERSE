// js/members.js — 회원관리(검색/미참석자/출석/권한/강제탈퇴/리셋)

/* ============ Firebase ============ */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import {
  getFirestore, collection, getDocs, getDoc, doc, updateDoc, deleteDoc,
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

    if (!IS_MASTER) $("#btnResetAttendance")?.setAttribute("disabled", "disabled");

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

function neverAttended(u) {
  const a = u.attendance || {};
  return !(a.camp || a.board || a.sport || a.free);
}

function applyFiltersAndRender() {
  const term = ($("#searchInput")?.value || "").trim();
  const onlyNever = $("#onlyNeverAttended")?.checked;
  let list = CACHE.filter(u => matchesTerm(u, term));
  if (onlyNever) list = list.filter(neverAttended);
  renderTable(list);
}

/* ============ 데이터 로드/렌더 ============ */
async function loadMembers() {
  const body = $("#membersBody");
  if (body) body.innerHTML = '<tr><td colspan="12">로딩 중…</td></tr>';

  const qSnap = await getDocs(collection(db, "users"));
  const rows = [];
  qSnap.forEach(d => rows.push({ id: d.id, ...d.data() }));
  rows.sort((a, b) => (a.name || "").localeCompare(b.name || "", "ko"));

  CACHE = rows;            // 서버 기준으로 캐시 갱신
  applyFiltersAndRender(); // 필터 적용 후 렌더
}

function renderTable(rows) {
  const tbody = document.createElement("tbody");
  tbody.id = "membersBody";
  for (const u of rows) tbody.appendChild(renderRow(u));
  $("#membersBody")?.replaceWith(tbody);
}

function renderRow(u) {
  const tr = document.createElement("tr");

  const gid = u.groups || {};
  const joined = { camp: !!gid.camp, board: !!gid.board, sport: !!gid.sport, free: !!gid.free };
  const att = u.attendance || {};

  const td = (cls, html) => {
    const x = document.createElement("td");
    if (cls) x.className = cls;
    x.innerHTML = html;
    return x;
  };

  tr.appendChild(td("col-id",    escapeHtml(getIdPart(u) || "-")));
  tr.appendChild(td("col-name",  escapeHtml(u.name || "-")));
  tr.appendChild(td("col-gy",    escapeHtml((u.gender || "-") + "/" + (u.birthYear || "-"))));
  tr.appendChild(td("col-phone", escapeHtml(u.phone || "-"))); // 읽기 전용
  tr.appendChild(td("col-region", escapeHtml(u.region || "-")));

  tr.appendChild(td("col-role", IS_MASTER
    ? (
      '<select class="sel-role" data-uid="' + u.id + '">' +
        '<option value="member"'  + sel(u.role, "member")  + '>member</option>' +
        '<option value="manager"' + sel(u.role, "manager") + '>manager</option>' +
        '<option value="master"'  + sel(u.role, "master")  + '>master</option>' +
      "</select>"
    )
    : escapeHtml(u.role || "member")
  ));

  tr.appendChild(td("col-att", joined.camp  ? cb(u.id, "camp",  !!att.camp)  : "–"));
  tr.appendChild(td("col-att", joined.board ? cb(u.id, "board", !!att.board) : "–"));
  tr.appendChild(td("col-att", joined.sport ? cb(u.id, "sport", !!att.sport) : "–"));
  tr.appendChild(td("col-att", joined.free  ? cb(u.id, "free",  !!att.free)  : "–"));

  const created = u.createdAt || u.created_at || null;
  tr.appendChild(td("col-created", created ? escapeHtml(fmtDate(created)) : "-"));

  tr.appendChild(td("col-ops",
    '<button class="btn danger btn-kick" data-uid="' + u.id + '"' +
    (u.id === auth.currentUser?.uid ? " disabled" : "") + ">강제탈퇴</button>"
  ));

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

  // 출석 토글
  tr.querySelectorAll(".att-cb").forEach(cbEl => {
    cbEl.addEventListener("change", async () => {
      const uid  = cbEl.dataset.uid;
      const key  = cbEl.dataset.key;
      const next = cbEl.checked;
      try {
        await updateDoc(doc(db, "users", uid), {
          ["attendance." + key]: next,
          updatedAt: serverTimestamp()
        });
        // 캐시 갱신(필터 토글/검색 바뀌어도 화면 상태 유지)
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

  // 강제탈퇴
  tr.querySelector(".btn-kick")?.addEventListener("click", async () => {
    const uid = tr.querySelector(".btn-kick").dataset.uid;
    if (!confirm("정말 강제탈퇴 하시겠습니까? 해당 계정/데이터가 삭제됩니다.")) return;
    try {
      await deleteDoc(doc(db, "users", uid));
      CACHE = CACHE.filter(x => x.id !== uid);
      applyFiltersAndRender();
      notify("강제탈퇴 완료");
    } catch (e) {
      console.error(e);
      notify("강제탈퇴 실패");
    }
  });

  return tr;
}

/* ============ 컨트롤 ============ */
function bindControls() {
  $("#searchInput")?.addEventListener("input", applyFiltersAndRender);
  $("#onlyNeverAttended")?.addEventListener("change", applyFiltersAndRender);

  // 새로고침(상단/우측 둘 다)
  $("#refreshBtn")?.addEventListener("click", () => loadMembers());
  $("#refreshBtn2")?.addEventListener("click", () => loadMembers());

  // 참석률 리셋(마스터만)
  $("#btnResetAttendance")?.addEventListener("click", async () => {
    if (!IS_MASTER) { notify("마스터만 가능합니다."); return; }
    if (!confirm("전 회원의 참석 상태를 ‘미참석’으로 초기화합니다. 진행할까요?")) return;

    try {
      const snap = await getDocs(collection(db, "users"));
      const batch = writeBatch(db);
      snap.forEach(d => {
        batch.update(doc(db, "users", d.id), {
          "attendance.camp":  false,
          "attendance.board": false,
          "attendance.sport": false,
          "attendance.free":  false,
          updatedAt: serverTimestamp()
        });
      });
      await batch.commit();

      // 캐시도 초기화
      CACHE = CACHE.map(u => ({
        ...u,
        attendance: { camp: false, board: false, sport: false, free: false }
      }));
      applyFiltersAndRender();
      notify("초기화 완료");
    } catch (e) {
      console.error(e);
      notify("초기화 실패");
    }
  });
}
