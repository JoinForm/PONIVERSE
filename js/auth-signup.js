// js/auth-signup.js (module) — 아이디/연락처 중복 체크 + 가입 후 home 이동
import {
  auth, db,
  createUserWithEmailAndPassword,
  updateProfile,
  doc, setDoc, serverTimestamp,
  collection, getDocs, query, where, limit
} from "./firebase.js";

const LIMIT_GENDER = 10;
const groupKeys = ["camp","board","sport"];

// 세 모임 모두 특정 성별이 마감인지 확인
async function isGenderAllClosed(gender){
  try{
    const counts = await Promise.all(
      groupKeys.map(k =>
        getDocs(
          query(
            collection(db, "users"),
            where(`groups.${k}`, "==", true),
            where("gender", "==", gender)
          )
        )
      )
    );
    // getDocs로 했으니 size 비교, 성능 더 중요하면 getCountFromServer로 변경 가능
    return counts.every(snap => (snap.size || 0) >= LIMIT_GENDER);
  }catch(e){
    console.error("[isGenderAllClosed] failed:", e);
    return false; // 장애 시 차단하지 않음
  }
}


// ====== 도우미 ======
const $ = (sel, ctx = document) => ctx.querySelector(sel);

function normalizePhone(v) { return (v || "").replace(/\D/g, ""); }
function formatPhone(v) {
  const d = normalizePhone(v);
  if (d.startsWith("02")) {
    return d.replace(/^(\d{0,2})(\d{0,4})(\d{0,4}).*/, (_, a, b, c) => [a, b, c].filter(Boolean).join("-"));
  }
  return d.replace(/^(\d{0,3})(\d{0,4})(\d{0,4}).*/, (_, a, b, c) => [a, b, c].filter(Boolean).join("-"));
}

function cleanUserId(userId) {
  // 소문자/숫자/언더스코어만 허용
  return (userId || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
}

function makeFakeEmailFromId(userId) {
  return `${cleanUserId(userId)}@poniverse.kr`;
}

const form   = document.getElementById("signupForm");
const phoneInput = $("input[name='phone']");
const msgBox = document.createElement("div");
msgBox.style.marginTop = "8px";
msgBox.style.textAlign = "center";
form.appendChild(msgBox);

function showMsg(msg, color = "salmon") {
  msgBox.style.color = color;
  msgBox.textContent = msg;
}

// 실시간 전화번호 하이픈
if (phoneInput) {
  phoneInput.addEventListener("input", () => {
    phoneInput.value = formatPhone(phoneInput.value);
  });
}

// ====== 제출 처리 ======
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  // 필드 수집
  const rawUserId = (form.userId?.value || "").trim();
  const userId = cleanUserId(rawUserId);         // ← 저장/중복검사 모두 소문자 기준
  const username = (form.username?.value || "").trim();
  const gender = form.gender?.value || "";
  const password = form.password?.value || "";
  const passwordConfirm = form.passwordConfirm?.value || "";
  const birthYear = form.birthYear?.value || "";
  const region = (form.region?.value || "").trim();
  const phoneRaw = (form.phone?.value || "").trim();
  const phoneDigits = normalizePhone(phoneRaw);
  const phone = formatPhone(phoneRaw);

  // 기본 검증
  if (!/^[a-z0-9_]{4,20}$/.test(userId)) {
    return showMsg("아이디는 영문/숫자/언더스코어 4~20자로 입력해주세요.");
  }
  if (!username) return showMsg("이름을 입력해주세요.");
  if (!gender) return showMsg("성별을 선택해주세요.");
  if (!birthYear) return showMsg("출생년도를 선택해주세요.");
  if (!region) return showMsg("지역을 입력해주세요.");
  if (password !== passwordConfirm) return showMsg("비밀번호가 일치하지 않습니다.");
  if (password.length < 6) return showMsg("비밀번호는 6자 이상이어야 합니다.");
  if (!/[A-Za-z]/.test(password)) return showMsg("비밀번호에는 최소 1개 이상의 영문자가 포함되어야 합니다.");
  if (!(phoneDigits.length === 10 || phoneDigits.length === 11)) {
    return showMsg("연락처는 10~11자리로 입력해주세요.");
  }

  const submitBtn = form.querySelector("button[type='submit']");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "중복 확인 중…";
  }
  showMsg("");

  try {
    // ====== 1) 아이디 중복 체크 (userId 필드로 단일 where)
    {
      const qId = query(
        collection(db, "users"),
        where("userId", "==", userId),
        limit(1)
      );
      const snapId = await getDocs(qId);
      if (!snapId.empty) {
        showMsg("이미 사용 중인 아이디입니다. 다른 아이디를 입력해주세요.");
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "가입하기"; }
        return;
      }
    }

    // ====== 2) 연락처 중복 체크 (phoneDigits 필드)
    {
      const qPhone = query(
        collection(db, "users"),
        where("phoneDigits", "==", phoneDigits),
        limit(1)
      );
      const snapPhone = await getDocs(qPhone);
      if (!snapPhone.empty) {
        showMsg("이미 등록된 연락처입니다. 다른 연락처를 입력하거나 로그인해 주세요.");
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "가입하기"; }
        return;
      }
    }

    // --- 성별 마감 차단 (세 모임 모두 마감 시) ---
    {
      const genderChosen = form.gender?.value || "";
      if (!genderChosen) return showMsg("성별을 선택해주세요.");

      // 세션 정보 우선 사용
      const maleClosed   = JSON.parse(sessionStorage.getItem("__MALE_ALL_CLOSED")   || "false");
      const femaleClosed = JSON.parse(sessionStorage.getItem("__FEMALE_ALL_CLOSED") || "false");
      const closedBySession = (genderChosen === "남" ? maleClosed : femaleClosed);

      let reallyClosed = closedBySession;
      if (reallyClosed === false) {
        // 세션이 false라도 정확히 한 번 서버에서 검증
        reallyClosed = await isGenderAllClosed(genderChosen);
        sessionStorage.setItem(
          genderChosen === "남" ? "__MALE_ALL_CLOSED" : "__FEMALE_ALL_CLOSED",
          JSON.stringify(reallyClosed)
        );
      }
      if (reallyClosed) {
        return showMsg(`현재 ${genderChosen} 회원은(는) 모든 모임이 마감되어 가입이 제한됩니다.`);
      }
    }


    // ====== 계정 생성
    if (submitBtn) submitBtn.textContent = "가입 처리 중…";

    const fakeEmail = makeFakeEmailFromId(userId);
    const cred = await createUserWithEmailAndPassword(auth, fakeEmail, password);

    await updateProfile(cred.user, { displayName: username });

    // Firestore 사용자 문서
    await setDoc(doc(db, "users", cred.user.uid), {
      uid: cred.user.uid,
      userId,                // 소문자 규칙으로 저장
      name: username,
      email: fakeEmail,
      gender,
      birthYear,
      region,
      phone,                 // "010-1234-5678"
      phoneDigits,           // "01012345678"
      role: "member",
      groups: { camp: false, board: false, sport: false, free: false }, 
      attendance: { camp: false, board: false, sport: false, free: false },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    showMsg("회원가입이 완료되었습니다! 홈으로 이동합니다.", "aquamarine");
    // ✅ 가입 완료 후 home으로 이동
    setTimeout(() => { location.href = "home.html"; }, 400);
  } catch (err) {
    console.error(err);
    const code = err?.code || "";
    if (code === "auth/email-already-in-use") {
      showMsg("이미 사용 중인 아이디입니다. 다른 아이디를 입력해주세요.");
    } else if (code === "auth/invalid-email") {
      showMsg("아이디 형식이 올바르지 않습니다. 영문/숫자/언더스코어 4~20자로 입력해주세요.");
    } else if (code === "auth/operation-not-allowed") {
      showMsg("이메일/비밀번호 가입이 비활성화되어 있습니다. 관리자에게 문의하세요.");
    } else if (code === "auth/weak-password") {
      showMsg("비밀번호가 너무 약합니다. 더 강한 비밀번호를 사용하세요.");
    } else {
      showMsg("회원가입 중 오류가 발생했습니다: " + (err?.message || err));
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "가입하기";
    }
  }
});

// ===== 모바일 스크롤 방해 제거 (선택: 기존 코드에 touchmove preventDefault가 있을 때만 필요)
document.addEventListener("DOMContentLoaded", async () => {
  const genderSel = form.gender; // <select name="gender"> 또는 라디오 name="gender"
  if (!genderSel) return;

  // 우선 index에서 세션으로 넘긴 값 활용(빠름)
  const maleClosed   = JSON.parse(sessionStorage.getItem("__MALE_ALL_CLOSED")   || "false");
  const femaleClosed = JSON.parse(sessionStorage.getItem("__FEMALE_ALL_CLOSED") || "false");

  // 화면 표시 및 비활성화
  const disableOpt = (val, closed) => {
    const opt = genderSel.querySelector(`option[value="${val}"]`) || genderSel.querySelector(`[value="${val}"]`);
    if (opt) opt.disabled = !!closed;
  };
  disableOpt("남", maleClosed);
  disableOpt("여", femaleClosed);

  // 세션 정보가 없거나 불확실하면 Firestore로 보정
  if (maleClosed === false && femaleClosed === false){
    const [mAll, fAll] = await Promise.all([isGenderAllClosed("남"), isGenderAllClosed("여")]);
    disableOpt("남", mAll);
    disableOpt("여", fAll);
    sessionStorage.setItem("__MALE_ALL_CLOSED",   JSON.stringify(mAll));
    sessionStorage.setItem("__FEMALE_ALL_CLOSED", JSON.stringify(fAll));
  }
});


