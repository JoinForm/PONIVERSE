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
  serverTimestamp, writeBatch, query, where, setDoc, deleteDoc   // ✅ deleteDoc 추가
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

/* ✅ 참가(가입) 전용 셀 — 참가 관리 모드에서 사용 */
function joinCell(uid, key, joined) {
  const checked = joined ? " checked" : "";
  return `
    <label class="join-cell">
      <input type="checkbox"
             class="join-cb"
             data-uid="${uid}"
             data-key="${key}"${checked}>
      <span>참가</span>
    </label>
  `;
}


/* ✅ 참가(가입) + 출석 체크박스 묶음 셀 */
/* ✅ 출석만 표시(참가 없음) */
function attCell(uid, key, attended) {
  const checked = attended ? " checked" : "";
  return `
    <label class="att-only" style="display:flex;justify-content:center;align-items:center;gap:6px;font-size:12px;">
      <input type="checkbox"
             class="att-cb"
             data-uid="${uid}"
             data-key="${key}"${checked}>
    </label>
  `;
}

function getIdPart(u) {
  const base = u.username || u.email || "";
  return base.split("@")[0] || "";
}

/* === 월별 출석용 헬퍼 === */

// "2025-12" 이런 형식으로 만들어주는 함수
function getMonthId(date){
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

// 현재 선택된 월 (기본: 오늘 기준)
let CURRENT_MONTH_ID = getMonthId(new Date());

// 월별 출석 캐시: { [uid]: { camp:bool, board:bool, sport:bool } }
let ATT_MONTH = {};


/* === 출석/가입 관련 유틸 === */
function isJoined(u, key) {
  const g = u.groups || {};
  const v = g[key];
  return v === true || v === "true" || v === 1;
}

function isAttended(u, key) {
  const a = ATT_MONTH[u.id] || {};
  return !!a[key];      // 해당 월의 출석만 본다
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
    } else {
      $("#btnResetAttendance")?.removeAttribute("disabled");
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

  const t = term.trim().toLowerCase();

  // ✅ 성별 검색어 지원: "남", "여", "남자", "여자"
  // "남"만 입력해도 남자만 나오게, "여"만 입력해도 여자만 나오게
  const gender = String(u.gender || "").trim(); // DB에 "남" / "여" 저장돼 있다고 가정

  const isGenderQuery =
    t === "남" || t === "여" || t === "남자" || t === "여자";

  if (isGenderQuery) {
    const want = (t === "남" || t === "남자") ? "남" : "여";
    return gender === want;
  }

  // ✅ 기존 검색(이름/지역/연락처/아이디)
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
  if (key !== "free") return false;        // ✅ free만
  if (!isJoined(u, "free")) return false;  // ✅ 자유 참가자만 대상
  return !isAttended(u, "free");           // ✅ 해당 월 자유 출석이 false면 미참석
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

  // ✅ 모임 선택 필터 (미참석 체크 여부와 무관하게 동작)
  // - onlyAbsent OFF: 해당 모임 가입자 전체
  // - onlyAbsent ON : 해당 모임 가입자 중 미참석자만
  if (onlyAbsent) {
    list = list.filter(u => isAbsentInGroup(u, "free"));
  }


  sortUsersByRoleThenJoined(list);
  renderTable(list);
}

/* ============ 데이터 로드/렌더 ============ */
async function loadMembers() {
  const body = $("#membersBody");
  if (body) body.innerHTML = '<tr><td colspan="9">로딩 중…</td></tr>'; // 9컬럼

  const monthId = CURRENT_MONTH_ID;   // 🔹 현재 선택된 월

  // 1) users 전체 읽기 (기존과 동일)
  const qSnap = await getDocs(collection(db, "users"));
  const rows = [];
  qSnap.forEach(d => rows.push({ id: d.id, ...d.data() }));
  sortUsersByRoleThenJoined(rows);
  CACHE = rows;

  // 2) 해당 월의 출석(attendance_monthly) 읽기
  ATT_MONTH = {};  // 초기화
  try {
    const attSnap = await getDocs(
      query(
        collection(db, "attendance_monthly"),
        where("monthId", "==", monthId)
      )
    );
    attSnap.forEach(docSnap => {
      const d = docSnap.data();
      ATT_MONTH[d.uid] = { free: !!d.free };
    });
  } catch (e) {
    console.error("[attendance_monthly load failed]", e);
  }

  // 3) 필터 적용 + 렌더
  applyFiltersAndRender();
}


function renderTable(rows) {
  const tbody = document.createElement("tbody");
  tbody.id = "membersBody";
  rows.forEach((u, i) => tbody.appendChild(renderRow(u, i))); // ✅ i 추가
  $("#membersBody")?.replaceWith(tbody);
}


function renderRow(u, idx = 0) {
  const tr = document.createElement("tr");
  tr.dataset.uid = u.id;

  const isDisabled = !!u.disabled;            // ✅ 이 줄이 없어서 터진거야
  const isMe = u.id === auth.currentUser?.uid;

  const joined = {
    free:  isJoined(u, "free")
  };
  const att = ATT_MONTH[u.id] || {};

  const td = (cls, html) => {
    const x = document.createElement("td");
    if (cls) x.className = cls;
    x.innerHTML = html;
    return x;
  };

  tr.appendChild(td("col-idx", String(idx + 1))); // 번호
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
      (isDisabled
        ? '<div class="disabled-label" style="margin-top:4px;font-size:11px;color:#ff9b9b;">(비활성화)</div>'
        : ""
      )
    )
    : escapeHtml((u.role || "member") + (isDisabled ? " (비활성)" : ""))
  ));


  const freeJoined = isJoined(u, "free");
  const freeAtt = !!(ATT_MONTH[u.id]?.free);

  tr.appendChild(
    td(
      "col-att",
      freeJoined ? attCell(u.id, "free", freeAtt) : '<span class="dash">-</span>'
    )
  );

  const created = u.createdAt || u.created_at || null;
  tr.appendChild(td("col-created", created ? escapeHtml(fmtDate(created)) : "-"));

  const btnLabel = isDisabled ? "활성화" : "비활성화";
  const btnDisabledAttr = isMe ? " disabled" : "";

  tr.appendChild(td("col-ops",
    // 비활성화/활성화
    '<button class="btn danger btn-toggle" data-uid="' + u.id + '"' +
      btnDisabledAttr + '>' + btnLabel + '</button>' +

    // ✅ 강퇴
    '<button class="btn kick btn-withdraw" data-uid="' + u.id + '">강퇴</button>'

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


  // ✅ 출석 체크 이벤트 (MODE 없이)
  tr.querySelectorAll(".att-cb").forEach(cbEl => {
    cbEl.addEventListener("change", async () => {
      const uid  = cbEl.dataset.uid;
      const key  = cbEl.dataset.key;
      if (key !== "free") return;

      const next = cbEl.checked;

      try {
        await saveMonthlyAttendance(uid, key, next);
        notify("출석 상태 저장됨");
      } catch (e) {
        console.error(e);
        notify("저장 실패");
        cbEl.checked = !next;
      }
    });
  });




  // 비활성화/활성화 토글
  const toggleBtn = tr.querySelector(".btn-toggle");
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

  // ✅ 강퇴(회원탈퇴) 버튼
  const withdrawBtn = tr.querySelector(".btn-withdraw");
  withdrawBtn?.addEventListener("click", async () => {
    if (withdrawBtn.disabled) return;

    const uid = withdrawBtn.dataset.uid;

    // 본인 강퇴 방지 (테스트)
    if (uid === auth.currentUser?.uid) {
      notify("본인은 강퇴할 수 없습니다.");
      return;
    }

    const reason = prompt("강퇴(회원탈퇴) 사유를 입력하세요.\n(취소하면 진행되지 않습니다.)", "");
    if (reason === null) return; // 취소

    const ok = confirm(
      "정말 강퇴(회원탈퇴) 처리할까요?\n\n" +
      "• 회원 정보(users)가 삭제됩니다.\n" +
      "• 출석 기록(attendance_monthly)이 삭제됩니다.\n" +
      "• 강퇴 기록(withdrawn_users)은 남습니다."
    );
    if (!ok) return;

    try {
      await kickAndWithdrawUser(uid, reason.trim());
      notify("강퇴(회원탈퇴) 처리 완료");
    } catch (e) {
      console.error(e);
      notify("강퇴 처리 실패(권한/규칙 확인 필요)");
    }
  });



  // 🔒 비활성화된 유저는 권한/출석/참가 입력 막기
  if (isDisabled) {
    tr.querySelectorAll(".att-cb").forEach(cbEl => {
      cbEl.disabled = true;
    });
    tr.querySelectorAll(".join-cb").forEach(jEl => {
      jEl.disabled = true;
    });

    const roleSelEl = tr.querySelector(".sel-role");
    if (roleSelEl) {
      roleSelEl.disabled = true;
    }
  }

  return tr;
}

// ✅ 강퇴(회원탈퇴) 처리: users 문서 삭제 + 출석 기록 삭제 + 기록 보관
async function kickAndWithdrawUser(uid, reason) {
  // 1) 유저 스냅샷(기록용)
  const uRef = doc(db, "users", uid);
  const uSnap = await getDoc(uRef);
  const uData = uSnap.exists() ? uSnap.data() : {};

  // 2) 강퇴 기록 보관(재가입 제한/로그 용도)
  //    - 필요 없으면 이 블록은 빼도 됨
  await setDoc(
    doc(db, "withdrawn_users", uid),
    {
      uid,
      type: "kicked",
      reason: reason || "",
      kickedAt: serverTimestamp(),
      // 필요한 최소 정보만 남기는 걸 추천
      name: uData.name || "",
      phone: uData.phone || "",
      email: uData.email || "",
      provider: uData.provider || "",
      kakaoUid: uData.kakaoUid || "",
    },
    { merge: true }
  );

  // 3) attendance_monthly에서 uid에 해당하는 문서 전부 삭제
  const attSnap = await getDocs(
    query(collection(db, "attendance_monthly"), where("uid", "==", uid))
  );

  if (!attSnap.empty) {
    const batch = writeBatch(db);
    attSnap.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }

  // 4) users 문서 삭제(= 서비스 탈퇴 처리)
  await deleteDoc(uRef);

  // 5) 로컬 캐시에서 제거 후 렌더
  CACHE = CACHE.filter(x => x.id !== uid);
  applyFiltersAndRender();
}


// 🔹 월별 출석 저장 (attendance_monthly 컬렉션)
async function saveMonthlyAttendance(uid, groupKey, value) {
  const monthId = CURRENT_MONTH_ID;
  const refId   = `${uid}_${monthId}`;
  const ref     = doc(db, "attendance_monthly", refId);

  await setDoc(
    ref,
    {
      uid,
      monthId,
      [groupKey]: value,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  // 로컬 캐시도 갱신
  const cur = ATT_MONTH[uid] || {};
  ATT_MONTH[uid] = { ...cur, [groupKey]: value };
}



/* ============ 참석률 리셋: 메인 모임별 ============ */
async function resetAttendance() {
  if (!IS_MANAGER) {
    notify("매니저 이상만 가능합니다.");
    return;
  }

  const msg = `${CURRENT_MONTH_ID} 월의 자유 출석 상태를 ‘미참석’으로 초기화합니다.\n\n진행하시겠습니까?`;
  if (!confirm(msg)) return;

  try {
    const monthId = CURRENT_MONTH_ID;

    // 해당 월 문서들만 가져오기
    const snap = await getDocs(
      query(collection(db, "attendance_monthly"), where("monthId", "==", monthId))
    );

    const batch = writeBatch(db);

    snap.forEach(d => {
      batch.set(
        d.ref,
        { free: false, updatedAt: serverTimestamp() },
        { merge: true }
      );
    });

    await batch.commit();

    // 로컬 캐시 갱신
    ATT_MONTH = Object.fromEntries(
      Object.entries(ATT_MONTH).map(([uid, att]) => [uid, { ...(att || {}), free: false }])
    );

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

  $("#onlyDisabled")?.addEventListener("change", applyFiltersAndRender);

  $("#refreshBtn")?.addEventListener("click", () => loadMembers());
  $("#refreshBtn2")?.addEventListener("click", () => loadMembers());

  $("#btnResetAttendance")?.addEventListener("click", () => resetAttendance());



  
  // 🔹 월 선택 컨트롤 바인딩
  const monthInput = $("#monthInput");
  const prevBtn    = $("#prevMonth");
  const nextBtn    = $("#nextMonth");

  if (monthInput) {
    // 페이지 진입 시 당월 기본값
    if (!monthInput.value) {
      monthInput.value = CURRENT_MONTH_ID;   // "YYYY-MM"
    }

    // 직접 월 선택 변경
    monthInput.addEventListener("change", () => {
      if (!monthInput.value) return;
      CURRENT_MONTH_ID = monthInput.value;
      loadMembers();
    });
  }

  // 이전 달
  prevBtn?.addEventListener("click", () => {
    if (!monthInput) return;
    const [y, m] = CURRENT_MONTH_ID.split("-").map(Number);
    const d = new Date(y, m - 2, 1); // JS month 0-based
    CURRENT_MONTH_ID = getMonthId(d);
    monthInput.value = CURRENT_MONTH_ID;
    loadMembers();
  });

  // 다음 달
  nextBtn?.addEventListener("click", () => {
    if (!monthInput) return;
    const [y, m] = CURRENT_MONTH_ID.split("-").map(Number);
    const d = new Date(y, m, 1); // +1 month
    CURRENT_MONTH_ID = getMonthId(d);
    monthInput.value = CURRENT_MONTH_ID;
    loadMembers();
  });
}


