// js/guide.js

const $ = (s, c = document) => c.querySelector(s);

// group 파라미터 읽기 (캠핑/보드/운동/자유 안내용)
function getGroup() {
  const u = new URL(location.href);
  const g = (u.searchParams.get("group") || "").toLowerCase();
  const allow = new Set(["camp", "board", "sport", "free"]);
  return allow.has(g) ? g : "";
}

function groupTitle(g) {
  return (
    {
      camp: "캠핑",
      board: "보드게임",
      sport: "운동",
      free: "자유",
    }[g] || "모임"
  );
}

// 텍스트 fetch 유틸
async function fetchText(url) {
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (res.ok) return await res.text();
  } catch (e) {
    /* ignore */
  }
  return null;
}

async function load() {
  const u = new URL(location.href);
  const docParam = (u.searchParams.get("doc") || "").toLowerCase().trim(); // 예: doc=info
  const g = getGroup();

  // 타이틀 엘리먼트: id="guideTitle"가 있으면 우선, 없으면 상단 h1 사용
  const titleEl = $("#guideTitle") || document.querySelector(".notice-header h1");
  if (titleEl) {
    if (g) {
      // 그룹 안내 모드
      titleEl.textContent = `${groupTitle(g)} 안내`;
    } else {
      // doc 파라미터가 있거나, 아무 것도 없거나 → 공통 제목
      titleEl.textContent = "모임 안내";
    }
  }

  const mdBox = $("#mdBox");
  if (!mdBox) return;

  // 어떤 MD 파일을 시도할지 후보 목록 구성
  const candidates = [];

  if (docParam) {
    // ✅ 설명 버튼 → guide.html?doc=info 같은 경우
    candidates.push(`docs/${docParam}.md`);
    if (docParam !== "info") {
      // 혹시 info 외 다른 값이 와도 info를 폴백으로 시도
      candidates.push("docs/info.md");
    }
    // 마지막 안전망
    candidates.push("docs/guide.md");
  } else if (g) {
    // ✅ 그룹별 안내 (guide.html?group=camp 등)
    candidates.push(`docs/${g}.md`);
    candidates.push("docs/guide.md");
  } else {
    // ✅ 그냥 guide.html만 직접 열었을 때
    candidates.push("docs/info.md");
    candidates.push("docs/guide.md");
  }

  // 로딩 표시
  mdBox.innerHTML = `<p class="md-loading">안내 문서를 불러오는 중…</p>`;

  let md = null;
  for (const url of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const t = await fetchText(
      url + (url.includes("?") ? "&" : "?") + "v=" + Date.now()
    );
    if (t) {
      md = t;
      break;
    }
  }

  if (!md) {
    mdBox.innerHTML = `<p>안내 문서를 찾을 수 없습니다.<br><small>${candidates.join(
      " , "
    )}</small></p>`;
    return;
  }

  // 마크다운 렌더
  const html = window.marked
    ? window.marked.parse(md)
    : md.replace(/\n/g, "<br>");
  mdBox.innerHTML = html;

  // 최상단 h1은 guide.html에서 이미 제목을 보여주고 있으므로 제거
  mdBox.querySelectorAll("h1").forEach((h) => h.remove());
}

load();
