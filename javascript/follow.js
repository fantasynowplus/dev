(function () {
  const container = document.getElementById("follow-links");
  if (!container || typeof FOLLOW_LINKS === "undefined") return;

  const html = FOLLOW_LINKS.map(function (link) {
    return (
      '<a class="follow-link-item" href="' + link.url + '" target="_blank" rel="noopener">' +
        '<div class="follow-icon" style="background:' + link.iconBg + '">' + link.iconSvg + '</div>' +
        '<div class="follow-label">' +
          '<p class="follow-name">' + link.name + '</p>' +
          '<p class="follow-handle">' + link.handle + '</p>' +
        '</div>' +
        '<div class="follow-chevron">&rsaquo;</div>' +
      '</a>'
    );
  }).join("");

  container.innerHTML = html;
})();
