(function () {
  var pathEl = document.getElementById("requestedPath");
  if (pathEl) {
    pathEl.textContent = "path: " + window.location.pathname;
  }
})();
