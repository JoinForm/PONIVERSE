// js/auth-signup.js — 카카오 로그인 + 추가 정보 입력 + DB 저장
import {
  auth, db,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  doc, setDoc, serverTimestamp,
  collection, getDocs, query, where, limit
} from "./firebase.js";

const LIMIT_GENDER = 10;
const groupKeys = ["camp","board","sport"];

// ────────────────────────────────────────
//  세 모임 모두 특정 성별이 마감인지 확인
// ────────────────────────────────────────
async function isGenderAllClosed(gender){
  try{
    const snaps = await Promise.all(
      groupKeys.map(k =>
        getDocs(
          query(
            collection(db, "users"),
            where(`groups.${k}`, "==", true),
            where("gender", "==", gender),
            where("role", "==", "member") // ✅ 운영진 제외
          )
        )
      )
    );
    return snaps.every(s => (s.size || 0) >= LIMIT_GENDER);
  }catch(e){
    console.error("[isGenderAllClosed] failed:", e);
    return false;
  }
}




// ────────────────────────────────────────
//  도우미 함수
// ────────────────────────────────────────
const $ = (sel, ctx = document) => ctx.querySelector(sel);

function normalizePhone(v) { return (v || "").replace(/\D/g, ""); }
function formatPhone(v) {
  const d = normalizePhone(v);
  if (d.startsWith("02")) {
    return d.replace(/^(\d{0,2})(\d{0,4})(\d{0,4}).*/, (_, a, b, c) =>
      [a, b, c].filter(Boolean).join("-")
    );
  }
  return d.replace(/^(\d{0,3})(\d{0,4})(\d{0,4}).*/, (_, a, b, c) =>
    [a, b, c].filter(Boolean).join("-")
  );
}

function makeEmailFromKakaoId(kakaoId){
  return `kakao_${kakaoId}@poniverse.kr`;
}
function makePasswordFromKakaoId(kakaoId){
  return `kakao_${kakaoId}_pw`;
}

// ────────────────────────────────────────
//  DOM 요소
// ────────────────────────────────────────
const form             = document.getElementById("signupForm");
const formGuideMsg     = document.getElementById("formGuideMsg");
const kakaoBtn         = document.getElementById("kakaoLoginBtn");
const cancelTopWrapper = document.getElementById("cancelTopWrapper");
const cancelTopBtn     = document.getElementById("cancelBtnTop");   // ★ 추가
const cancelFormBtn    = document.getElementById("cancelBtnForm");
const phoneInput       = $("input[name='phone']");
const kakaoStatus      = document.getElementById("kakaoStatus");
const msgBox           = document.getElementById("signupMsg");


function showMsg(msg, color = "salmon") {
  if (!msgBox) return;
  if (!msg) {
    msgBox.style.display = "none";
    msgBox.textContent = "";
    return;
  }
  msgBox.style.display = "block";
  msgBox.style.color = color;
  msgBox.textContent = msg;
}

// 실시간 전화번호 하이픈
if (phoneInput) {
  phoneInput.addEventListener("input", () => {
    phoneInput.value = formatPhone(phoneInput.value);
  });
}

// 폼 비활성화 상태로 시작
function setFormEnabled(enabled){
  if (!form) return;
  const els = form.querySelectorAll("input, select, button[type='submit']");
  els.forEach(el => el.disabled = !enabled);
}
setFormEnabled(false);

// 카카오 프로필 저장용
let kakaoProfile = null;
let firebaseUser = null;

// ────────────────────────────────────────
//  카카오 로그인 처리
// ────────────────────────────────────────
async function handleKakaoLogin() {
  if (!window.Kakao) {
    alert("카카오 SDK가 로드되지 않았습니다.");
    return;
  }

  try {
    if (kakaoStatus) kakaoStatus.textContent = "카카오 로그인 진행 중…";
    showMsg("");

    // 1) 카카오 로그인
    await new Promise((resolve, reject) => {
      Kakao.Auth.login({ success: resolve, fail: reject });
    });

    // 2) 사용자 정보 조회
    const me = await new Promise((resolve, reject) => {
      Kakao.API.request({
        url: "/v2/user/me",
        success: resolve,
        fail: reject,
      });
    });

    const kakaoId       = me.id;
    const kakaoNickname = me?.kakao_account?.profile?.nickname || "";
    const kakaoEmail    = me?.kakao_account?.email || "";

    kakaoProfile = { kakaoId, kakaoNickname, kakaoEmail };

    // ✅ 이미 가입된 카카오 계정인지 확인 (users에 kakaoId 존재하면 차단)
    const qKakao = query(
      collection(db, "users"),
      where("kakaoId", "==", kakaoId),
      limit(1)
    );
    const snapKakao = await getDocs(qKakao);

    if (!snapKakao.empty) {
      // 이미 가입된 계정
      showMsg("이미 가입된 카카오 계정입니다. 로그인 페이지로 이동합니다.", "salmon");

      // (선택) 카카오 안내문구 갱신
      if (kakaoStatus) {
        kakaoStatus.style.display = "block";
        kakaoStatus.textContent = "이미 가입된 카카오 계정입니다.";
      }

      // 폼은 열지 않기
      if (form) form.style.display = "none";
      if (formGuideMsg) formGuideMsg.style.display = "none";

      setTimeout(() => {
        location.href = "login.html"; // 또는 home.html
      }, 700);

      return; // ⭐ 여기서 handleKakaoLogin 종료
    }


    // ───────────── UI 변경 ─────────────
    if (kakaoBtn) kakaoBtn.style.display = "none";
    if (cancelTopWrapper) cancelTopWrapper.style.display = "none";

    // 기존 카카오 안내문구 숨기기
    if (kakaoStatus) kakaoStatus.style.display = "none";

    // ★ 추가 정보 안내 문구 활성화
    if (formGuideMsg) formGuideMsg.style.display = "block";

    // 폼 활성화
    if (form) {
      form.style.display = "block";
      setFormEnabled(true);
    }

  } catch (err) {
    console.error("카카오 로그인 실패:", err);
    if (kakaoStatus) {
      kakaoStatus.style.display = "block";
      kakaoStatus.textContent = "카카오 로그인에 실패했습니다. 다시 시도해주세요.";
    }
    showMsg("카카오 로그인 중 오류가 발생했습니다.");
  }
}

if (kakaoBtn) {
  kakaoBtn.addEventListener("click", handleKakaoLogin);
}

// 상단(카카오 영역) 취소 버튼 → 홈으로 이동
if (cancelTopBtn) {
  cancelTopBtn.addEventListener("click", () => {
    location.href = "index.html";
  });
}

// 폼 안 취소 버튼 → 홈으로 이동
if (cancelFormBtn) {
  cancelFormBtn.addEventListener("click", () => {
    location.href = "index.html";
  });
}



// ────────────────────────────────────────
//  추가 정보 → 가입 처리
// ────────────────────────────────────────
if (form) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!kakaoProfile) return showMsg("카카오 로그인을 먼저 진행해주세요.");

    // 필드 수집
    const username = (form.username?.value || "").trim();
    const gender   = form.gender?.value || "";
    const birthYear = form.birthYear?.value || "";
    const region   = (form.region?.value || "").trim();
    const phoneRaw = (form.phone?.value || "").trim();
    const phoneDigits = normalizePhone(phoneRaw);
    const phone = formatPhone(phoneRaw);
    const agreePrivacy = form.agreePrivacy?.checked === true;

    // 기본 검증
    if (!username) return showMsg("이름을 입력해주세요.");
    if (!gender) return showMsg("성별을 선택해주세요.");
    if (!birthYear) return showMsg("출생년도를 선택해주세요.");
    if (!region) return showMsg("지역을 입력해주세요.");
    if (!(phoneDigits.length === 10 || phoneDigits.length === 11))
      return showMsg("연락처는 10~11자리로 입력해주세요.");
    if (!agreePrivacy) return showMsg("개인정보 이용에 동의해주세요.");

    const submitBtn = form.querySelector("button[type='submit']");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "중복 확인 중…";
    }
    showMsg("");

    try {
      // ① 연락처 중복 체크
      const qPhone = query(
        collection(db, "users"),
        where("phoneDigits", "==", phoneDigits),
        limit(1)
      );
      const snapPhone = await getDocs(qPhone);
      if (!snapPhone.empty) {
        showMsg("이미 등록된 연락처입니다.");
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "가입하기";
        }
        return;
      }

      // ② 성별 마감 여부 체크 (캐시 여부와 무관하게 최종은 DB 기준)
      const genderChosen = gender;

      // 항상 DB 기준으로 최종 확인
      const reallyClosed = await isGenderAllClosed(genderChosen);

      // 캐시 갱신(다음 페이지/다음 시도에 UI에서 참고 가능)
      sessionStorage.setItem(
        genderChosen === "남" ? "__MALE_ALL_CLOSED" : "__FEMALE_ALL_CLOSED",
        JSON.stringify(reallyClosed)
      );

      if (reallyClosed) {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "가입하기";
        }
        showMsg(`현재 ${genderChosen} 회원은(는) 모든 모임이 마감되어 가입이 제한됩니다.`);
        return;
      }

      if (submitBtn) submitBtn.textContent = "가입 처리 중…";


      // ③ Firebase Auth 계정 생성/로그인
      const email = makeEmailFromKakaoId(kakaoProfile.kakaoId);
      const password = makePasswordFromKakaoId(kakaoProfile.kakaoId);

      try {
        const credNew = await createUserWithEmailAndPassword(auth, email, password);
        firebaseUser = credNew.user;
        await updateProfile(firebaseUser, {
          displayName: kakaoProfile.kakaoNickname || "Poniverse User"
        });
      } catch (err) {
        if (err.code === "auth/email-already-in-use") {
          showMsg("이미 가입된 카카오 계정입니다. 로그인 페이지로 이동합니다.");
          setTimeout(() => location.href = "login.html", 700);
          return;
        } else {
          console.error("Auth 에러:", err);
          throw err;
        }
      }

      // ④ Firestore 저장
      const userDocRef = doc(db, "users", firebaseUser.uid);
      await setDoc(
        userDocRef,
        {
          uid: firebaseUser.uid,
          kakaoId: kakaoProfile.kakaoId,
          kakaoNickname: kakaoProfile.kakaoNickname || "",
          kakaoEmail: kakaoProfile.kakaoEmail || "",
          name: username,
          email: kakaoProfile.kakaoEmail || email,
          gender,
          birthYear,
          region,
          phone,
          phoneDigits,
          role: "member",
          groups: { camp: false, board: false, sport: false, free: false },
          attendance: { camp: false, board: false, sport: false, free: false },
          agreedPrivacy: true,
          privacyAgreedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      showMsg("회원가입이 완료되었습니다! 홈으로 이동합니다.", "aquamarine");
      setTimeout(() => {
        location.href = "home.html";
      }, 400);

    } catch (err) {
      console.error(err);
      showMsg("회원정보 저장 중 오류가 발생했습니다: " + (err?.message || err));
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "가입하기";
      }
    }
  });
}

// ────────────────────────────────────────
//  성별 옵션 비활성화 처리
// ────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  if (!form) return;

  const genderSel = form.gender;
  if (!genderSel) return;

  const disableOpt = (val, closed) => {
    const opt = genderSel.querySelector(`option[value="${val}"]`);
    if (opt) opt.disabled = !!closed;
  };

  // 1) 캐시 반영 (일단 UI 빠르게)
  let maleClosed = JSON.parse(sessionStorage.getItem("__MALE_ALL_CLOSED") || "false");
  let femaleClosed = JSON.parse(sessionStorage.getItem("__FEMALE_ALL_CLOSED") || "false");
  disableOpt("남", maleClosed);
  disableOpt("여", femaleClosed);

  // 2) 캐시가 true면 "혹시 풀렸나" 재검증
  //    캐시가 false여도 최신화를 위해 재검증하고 싶으면 둘 다 재검증해도 됨
  const [mAll, fAll] = await Promise.all([
    isGenderAllClosed("남"),
    isGenderAllClosed("여"),
  ]);

  disableOpt("남", mAll);
  disableOpt("여", fAll);

  sessionStorage.setItem("__MALE_ALL_CLOSED", JSON.stringify(mAll));
  sessionStorage.setItem("__FEMALE_ALL_CLOSED", JSON.stringify(fAll));
});


