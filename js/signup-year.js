// signup-year.js
document.addEventListener("DOMContentLoaded", () => {
  const yearSel = document.querySelector("select[name='birthYear']");
  if (!yearSel) return;
  for (let y = 1990; y <= 2000; y++) {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    yearSel.appendChild(opt);
  }
});
