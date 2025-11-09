// js/auth-login.js
import {
  auth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  persistenceReady
} from "./firebase.js";

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const form = $("#loginForm");
const msg = $("#loginMsg");

function showMsg(text, color = "salmon") {
  if (!msg) return;
  msg.style.color = color;
  msg.textContent = text;
}

function makeFakeEmailFromId(userId) {
  // 회원가입과 동일한 규칙: 아이디@poniverse.kr
  const clean = (userId || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
  return `${clean}@poniverse.kr`;
}

// 이미 로그인 상태면 홈으로
await persistenceReady; // 로컬 퍼시스턴스 설정 보장
onAuthStateChanged(auth, (user) => {
  if (user) {
    // 이미 로그인 상태
    location.href = "home.html";
  }
});

// 제출 처리
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const userId = (form.userId?.value || "").trim();
  const password = form.password?.value || "";

  if (!/^[A-Za-z0-9_]{4,20}$/.test(userId)) {
    return showMsg("아이디는 영문/숫자/언더스코어 4~20자로 입력해주세요.");
  }
  if (password.length < 6) {
    return showMsg("비밀번호는 6자 이상이어야 합니다.");
  }

  const submitBtn = form.querySelector("button[type='submit']");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "로그인 중…";
  }
  showMsg("");

  try {
    const fakeEmail = makeFakeEmailFromId(userId);
    await signInWithEmailAndPassword(auth, fakeEmail, password);
    showMsg("로그인 성공! 홈으로 이동합니다.", "aquamarine");
    location.href = "home.html";
  } catch (err) {
    console.error(err);
    const code = err?.code || "";
    if (code === "auth/invalid-credential" || code === "auth/wrong-password") {
      showMsg("아이디 또는 비밀번호가 올바르지 않습니다.");
    } else if (code === "auth/user-not-found") {
      showMsg("가입 이력이 없습니다. 먼저 회원가입을 해주세요.");
    } else if (code === "auth/too-many-requests") {
      showMsg("잠시 후 다시 시도해주세요. (요청 과다)");
    } else {
      showMsg("로그인 중 오류가 발생했습니다: " + (err?.message || err));
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "로그인";
    }
  }
});
