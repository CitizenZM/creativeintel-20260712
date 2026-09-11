(function () {
  try {
    var m = localStorage.getItem("ci-theme") || "system";
    var d = m === "dark" || (m === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    if (d) document.documentElement.classList.add("dark");
  } catch (e) {}
})();
