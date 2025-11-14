// js/auth-login.js — 카카오 계정으로 로그인

// firebase.js 에서 가져오는 것들
import {
  auth, db,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  persistenceReady,
  getDoc, doc
} from "./firebase.js";

// signOut은 CDN에서 직접 import (firebase.js에서 안 내보내도 됨)
import { signOut } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";

const $ = (sel, ctx = document) => ctx.querySelector(sel);

const kakaoBtn = $("#kakaoLoginBtn");
const statusEl = $("#kakaoLoginStatus");
const msgBox   = $("#loginMsg");

function showMsg(text, color = "salmon") {
  if (!msgBox) return;

  if (!text) {
    msgBox.textContent = "";
    msgBox.style.display = "none";
    return;
  }

  msgBox.style.display = "block";
  msgBox.style.color = color;
  msgBox.textContent = text;
}

// 회원가입 때와 동일한 규칙: kakao_<id>@poniverse.kr / kakao_<id>_pw
function makeEmailFromKakaoId(kakaoId) {
  return `kakao_${kakaoId}@poniverse.kr`;
}
function makePasswordFromKakaoId(kakaoId) {
  return `kakao_${kakaoId}_pw`;
}

// ────────────────────────────────────────
//  이미 로그인 상태면 바로 홈으로
// ────────────────────────────────────────
await persistenceReady; // 로컬 퍼시스턴스 설정 보장

onAuthStateChanged(auth, (user) => {
  if (user) {
    location.href = "home.html";
  }
});

// ────────────────────────────────────────
//  카카오 로그인 처리
// ────────────────────────────────────────
async function handleKakaoLogin() {
  if (!window.Kakao) {
    alert("카카오 SDK가 로드되지 않았습니다.");
    return;
  }

  try {
    if (statusEl) statusEl.textContent = "카카오 로그인 중입니다…";
    showMsg("");

    // 1) 카카오 로그인
    await new Promise((resolve, reject) => {
      Kakao.Auth.login({
        success: resolve,
        fail: reject,
      });
    });

    // 2) 내 정보 조회 (kakaoId 얻기)
    const me = await new Promise((resolve, reject) => {
      Kakao.API.request({
        url: "/v2/user/me",
        success: resolve,
        fail: reject,
      });
    });

    const kakaoId = me.id;
    // const kakaoNickname = me?.kakao_account?.profile?.nickname || "";

    const email    = makeEmailFromKakaoId(kakaoId);
    const password = makePasswordFromKakaoId(kakaoId);

    // 버튼 잠깐 비활성화
    if (kakaoBtn) {
      kakaoBtn.disabled = true;
      kakaoBtn.textContent = "로그인 중…";
    }

    // 3) Firebase 로그인 시도
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);

      // ─ disabled 계정인지 확인 ─
      try {
        const userDoc = await getDoc(doc(db, "users", cred.user.uid));
        if (userDoc.exists() && userDoc.data().disabled === true) {
          showMsg("정지된 계정입니다. 관리자에게 문의하세요.", "salmon");
          if (statusEl) statusEl.textContent = "정지된 계정입니다.";

          // 바로 로그아웃 처리
          await signOut(auth);
          return;
        }
      } catch (e) {
        console.error("disabled 상태 확인 중 오류:", e);
        // 여기서 실패해도 로그인 자체를 실패로 보지는 않음
      }

      console.log("Firebase 로그인 성공:", cred.user.uid);

      if (statusEl) statusEl.textContent = "";
      showMsg("로그인에 성공했습니다! 홈으로 이동합니다.", "aquamarine");

      setTimeout(() => {
        location.href = "home.html";
      }, 400);

    } catch (err) {
      console.error("Firebase 로그인 실패:", err);
      const code = err?.code || "";

      if (code === "auth/user-not-found") {
        showMsg("아직 가입되지 않은 카카오 계정입니다. 먼저 회원가입을 진행해주세요.", "salmon");
        if (statusEl) statusEl.textContent = "회원가입이 필요합니다.";
      } else if (code === "auth/invalid-credential" || code === "auth/wrong-password") {
        showMsg("로그인 정보가 일치하지 않습니다. 관리자에게 문의해주세요.", "salmon");
      } else {
        showMsg("로그인 중 오류가 발생했습니다: " + (err.message || err), "salmon");
        if (statusEl) statusEl.textContent = "로그인에 실패했습니다.";
      }
    } finally {
      if (kakaoBtn) {
        kakaoBtn.disabled = false;
        kakaoBtn.innerHTML = '<span class="emoji">💛</span><span>카카오로 로그인</span>';
      }
    }

  } catch (err) {
    console.error("카카오 로그인 실패:", err);
    if (statusEl) statusEl.textContent = "카카오 로그인에 실패했습니다. 다시 시도해주세요.";
    showMsg("카카오 로그인 중 오류가 발생했습니다.", "salmon");
  }
}

// 버튼 연결
if (kakaoBtn) {
  kakaoBtn.addEventListener("click", handleKakaoLogin);
}
