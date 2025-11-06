// auth-signup.js
import {
  auth, db,
  createUserWithEmailAndPassword,
  updateProfile,
  doc, setDoc, serverTimestamp
} from "./firebase.js";

const form = document.getElementById("signupForm");
const msgBox = document.createElement("div");
msgBox.style.marginTop = "8px";
msgBox.style.textAlign = "center";
form.appendChild(msgBox);

function showMsg(text, color = "salmon") {
  msgBox.style.color = color;
  msgBox.textContent = text;
}

// 한글 이름 기반 이메일 생성
function makeFakeEmail(name) {
  const clean = name.replace(/\s+/g, "").replace(/[^ㄱ-ㅎ가-힣a-zA-Z0-9]/g, "");
  return `${clean}@poniverse.kr`;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const username = form.username.value.trim();
  const gender = form.gender.value;
  const password = form.password.value;
  const passwordConfirm = form.passwordConfirm.value;
  const birthYear = form.birthYear.value;
  const region = form.region.value.trim();

  if (!username) return showMsg("아이디(이름)을 입력해주세요.");
  if (!gender) return showMsg("성별을 선택해주세요.");
  if (!birthYear) return showMsg("출생년도를 선택해주세요.");
  if (!region) return showMsg("지역을 입력해주세요.");
  if (password !== passwordConfirm) return showMsg("비밀번호가 일치하지 않습니다.");
  if (password.length < 6) return showMsg("비밀번호는 6자 이상이어야 합니다.");

  const fakeEmail = makeFakeEmail(username);
  const role = "member"; // 기본 권한

  const submitBtn = form.querySelector("button[type='submit']");
  if (submitBtn) submitBtn.disabled = true;

  try {
    const cred = await createUserWithEmailAndPassword(auth, fakeEmail, password);
    await updateProfile(cred.user, { displayName: username });

    await setDoc(doc(db, "users", cred.user.uid), {
      uid: cred.user.uid,
      name: username,
      email: fakeEmail,
      gender,
      birthYear,
      region,
      role, // member | manager | master
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    showMsg("회원가입이 완료되었습니다!", "aquamarine");
    form.reset();
  } catch (err) {
    console.error(err);
    if (err?.code === "auth/email-already-in-use") {
      showMsg("이미 사용 중인 이름입니다.");
    } else if (err?.code === "auth/invalid-email") {
      showMsg("이름 형식이 올바르지 않습니다. 다른 이름을 사용해주세요.");
    } else {
      showMsg("회원가입 중 오류가 발생했습니다: " + (err?.message || err));
    }
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});
