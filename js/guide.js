// js/guide.js
const $ = (s, c=document)=>c.querySelector(s);

function getGroup(){
  const u = new URL(location.href);
  const g = (u.searchParams.get("group") || "").toLowerCase();
  const allow = new Set(["camp","board","sport","free"]);
  return allow.has(g) ? g : "";
}
function groupTitle(g){
  return ({camp:"캠핑", board:"보드게임", sport:"운동", free:"자유"}[g] || "모임");
}

async function fetchText(url){
  try{
    const res = await fetch(url, { cache:"no-cache" });
    if(res.ok) return await res.text();
  }catch(e){/* ignore */}
  return null;
}

async function load(){
  const g = getGroup();
  const titleEl = $("#guideTitle");
  if(titleEl) titleEl.textContent = g ? `${groupTitle(g)} 안내` : "모임 안내";

  const mdBox = $("#mdBox");
  if(!mdBox) return;

  const candidates = g
    ? [`docs/${g}.md`, "docs/guide.md"]
    : ["docs/guide.md"];

  let md = null;
  for(const url of candidates){
    // eslint-disable-next-line no-await-in-loop
    const t = await fetchText(url + (url.includes("?") ? "&" : "?") + "v=" + Date.now());
    if(t){ md = t; break; }
  }

  if(!md){
    mdBox.innerHTML = `<p>안내 문서를 찾을 수 없습니다.</p>`;
    return;
  }

  // 마크다운 렌더
  const html = window.marked ? window.marked.parse(md) : md.replace(/\n/g,"<br>");
  mdBox.innerHTML = html;

  // ✅ 방법 1: 렌더 후 h1(큰 제목) 자동 제거
  //    (guide.html의 상단 타이틀을 사용하고, MD의 최상단 제목은 숨김)
  mdBox.querySelectorAll("h1").forEach(h => h.remove());
}
load();
