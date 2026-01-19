// js/gallery.js — 사진첩 페이지 (thumb grid + full modal)
// - list.json 기반
// - 그리드는 thumb 로딩(빠름)
// - 클릭 시 모달은 full 로딩(원본)
// - 10개씩 페이지네이션
// - ESC/←/→ 지원
// - 비회원도 접근 가능

const $  = (sel, ctx=document) => ctx.querySelector(sel);
const $$ = (sel, ctx=document) => Array.from(ctx.querySelectorAll(sel));

const galleryEl = $("#gallery");
const imgModal  = $("#imgModal");
const modalImg  = $("#modalImg");
const prevBtn   = $("#imgPrev");
const nextBtn   = $("#imgNext");

const PER_PAGE = 10;

// ✅ 경로: 폴더만 맞춰주면 됨
const THUMB_DIR = "image/photo/thumb/";
const FULL_DIR  = "image/photo/full/";   // ← 여기 full 폴더에 원본 있어야 함

let FILES = [];          // list.json의 "파일명 배열" (ex: "sample (15).jpg")
let currentPage = 1;
let currentIndex = 0;

function thumbSrc(name){
  return THUMB_DIR + name;
}
function fullSrc(name){
  return FULL_DIR + name;
}

/* -----------------------
   Modal
----------------------- */
function hideModal(){
  if(!imgModal) return;
  imgModal.setAttribute("aria-hidden", "true");
  imgModal.setAttribute("hidden", "");
  // 모달 닫을 때 큰 이미지 메모리 해제 느낌으로 src 비우기(선택)
  if(modalImg) modalImg.src = "";
}

function showImageAt(index){
  if(!imgModal || !modalImg || FILES.length === 0) return;

  if(index < 0) index = FILES.length - 1;
  if(index >= FILES.length) index = 0;

  currentIndex = index;

  const name = FILES[index];

  // ✅ 모달은 full 로드
  modalImg.src = fullSrc(name);

  imgModal.removeAttribute("hidden");
  imgModal.setAttribute("aria-hidden", "false");
}

/* -----------------------
   Pager
----------------------- */
function ensurePager(){
  let el = $("#galleryPager");
  if(!el){
    el = document.createElement("div");
    el.id = "galleryPager";
    el.className = "gallery-pager";
    galleryEl?.after(el);
  }
  return el;
}

function renderPager(){
  const el = ensurePager();
  const totalPages = Math.ceil(FILES.length / PER_PAGE);

  if(totalPages <= 1){
    el.innerHTML = "";
    return;
  }

  el.innerHTML = Array.from({length: totalPages}, (_, i)=> i+1)
    .map(p => `<button class="page-btn${p===currentPage ? " active":""}" data-page="${p}">${p}</button>`)
    .join("");

  el.querySelectorAll("button").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      currentPage = parseInt(btn.dataset.page, 10);
      renderPage(currentPage);
      renderPager();
      window.scrollTo({ top: galleryEl.offsetTop - 100, behavior:"smooth" });
    });
  });
}

/* -----------------------
   Render
----------------------- */
function renderPage(page){
  if(!galleryEl) return;

  const start = (page - 1) * PER_PAGE;
  const end   = start + PER_PAGE;
  const slice = FILES.slice(start, end);

  // ✅ 그리드는 thumb만 로딩
  galleryEl.innerHTML = slice.map((name, idx) => {
    const globalIndex = start + idx;
    const src = thumbSrc(name);

    // 첫 2장은 LCP 개선(선택)
    const eager = idx < 2 ? `loading="eager" fetchpriority="high"` : `loading="lazy"`;

    return `
      <img class="hover-zoom"
           src="${src}"
           alt="pic"
           ${eager}
           decoding="async"
           width="400"
           height="300"
           data-idx="${globalIndex}"
           onerror="this.style.display='none'">
    `;
  }).join("");

  galleryEl.querySelectorAll("img[data-idx]").forEach(img=>{
    img.addEventListener("click", ()=>{
      const idx = parseInt(img.dataset.idx, 10);
      showImageAt(idx);
    });
  });

  // ✅ 다음 페이지 thumb 살짝 프리로드(체감 부드러움)
  preloadNextThumbs(page + 1);
}

function preloadNextThumbs(page){
  const totalPages = Math.ceil(FILES.length / PER_PAGE);
  if(page > totalPages) return;

  const start = (page - 1) * PER_PAGE;
  const end   = start + PER_PAGE;
  const slice = FILES.slice(start, end);

  slice.forEach(name=>{
    const im = new Image();
    im.decoding = "async";
    im.loading = "eager";
    im.src = thumbSrc(name);
  });
}

/* -----------------------
   Load list.json
----------------------- */
async function loadList(){
  if(!galleryEl) return;

  try{
    const res = await fetch("image/photo/list.json", { cache: "no-cache" });
    if(!res.ok) throw new Error("list.json not found");

    const json = await res.json();
    if(!Array.isArray(json) || json.length === 0) throw new Error("list.json empty");

    FILES = json.filter(Boolean).map(String);

    currentPage = 1;
    renderPage(currentPage);
    renderPager();

  }catch(e){
    console.warn("[gallery] list.json load failed:", e);
    galleryEl.innerHTML = `
      <p style="text-align:center; opacity:.85; padding:24px;">
        사진 목록(list.json)을 불러올 수 없어요.<br>
        <span style="opacity:.8;">image/photo/list.json 파일을 만들어 주세요.</span>
      </p>
    `;
    ensurePager().innerHTML = "";
  }
}

/* -----------------------
   Events
----------------------- */
imgModal?.addEventListener("click", (e)=>{
  if(e.target === imgModal) hideModal();
});

$$("[data-close]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    if(btn.getAttribute("data-close") === "imgModal") hideModal();
  });
});

prevBtn?.addEventListener("click", (e)=>{
  e.stopPropagation();
  showImageAt(currentIndex - 1);
});
nextBtn?.addEventListener("click", (e)=>{
  e.stopPropagation();
  showImageAt(currentIndex + 1);
});

document.addEventListener("keydown", (e)=>{
  if(e.key === "Escape"){
    hideModal();
    return;
  }
  if(imgModal?.hasAttribute("hidden")) return;

  if(e.key === "ArrowLeft")  showImageAt(currentIndex - 1);
  if(e.key === "ArrowRight") showImageAt(currentIndex + 1);
});

// Start
loadList();
