(function () {
  const container = document.getElementById("follow-links");
  if (!container || typeof FOLLOW_SECTIONS === "undefined") return;

  function extraHtml(link) {
    return (link.extra || []).map(function (chip) {
      return (
        '<a class="follow-chip" href="' + chip.url + '" target="_blank" rel="noopener">' +
          '<span class="follow-chip-icon" style="background:' + chip.iconBg + '">' + chip.iconSvg + '</span>' +
          '<span class="follow-chip-text">' + chip.name + ' &middot; ' + chip.handle + '</span>' +
        '</a>'
      );
    }).join("");
  }

  function videoPlaceholderHtml(link) {
    // Empty container the video sync fills in once data/latest-videos.json loads.
    // Kept out of the DOM entirely for cards with no videoKey.
    if (!link.videoKey) return "";
    return '<div class="follow-video-slot" data-video-key="' + link.videoKey + '"></div>';
  }

  function cardHtml(link) {
    return (
      '<div class="follow-card">' +
        '<a class="follow-link-main" href="' + link.url + '" target="_blank" rel="noopener">' +
          '<div class="follow-icon" style="background:' + link.iconBg + '">' + link.iconSvg + '</div>' +
          '<div class="follow-label">' +
            '<p class="follow-name">' + link.name + '</p>' +
            '<p class="follow-handle">' + link.handle + '</p>' +
          '</div>' +
          '<div class="follow-chevron">&rsaquo;</div>' +
        '</a>' +
        videoPlaceholderHtml(link) +
        (link.extra && link.extra.length ? '<div class="follow-extra">' + extraHtml(link) + '</div>' : '') +
      '</div>'
    );
  }

  const html = FOLLOW_SECTIONS.map(function (section) {
    const cards = section.links.map(cardHtml).join("");
    return (
      '<div class="follow-section">' +
        '<p class="follow-section-title">' + section.title + '</p>' +
        '<div class="follow-links-group">' + cards + '</div>' +
      '</div>'
    );
  }).join("");

  container.innerHTML = html;

  // Fill in latest-video previews from the youtube_videos table
  // (synced by scripts/fetch-latest-videos.mjs) via the yt_latest_videos RPC.
  const SUPABASE_URL = "https://fckobcxprmudfpxdmswi.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZja29iY3hwcm11ZGZweGRtc3dpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2MTI5MzcsImV4cCI6MjA5OTE4ODkzN30.9wMb0SXAZs-jo1G9xRxk5M47fJIIU7-DTJTl1yFRwFk";

  const sourceIds = Array.from(document.querySelectorAll(".follow-video-slot"))
    .map(function (slot) { return slot.getAttribute("data-video-key"); });

  if (sourceIds.length) {
    fetch(SUPABASE_URL + "/rest/v1/rpc/yt_latest_videos", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: "Bearer " + SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ p_source_ids: sourceIds })
    })
      .then(function (res) {
        if (!res.ok) throw new Error("yt_latest_videos failed");
        return res.json();
      })
      .then(function (rows) {
        const bySourceId = {};
        (rows || []).forEach(function (row) { bySourceId[row.source_id] = row; });

        document.querySelectorAll(".follow-video-slot").forEach(function (slot) {
          const key = slot.getAttribute("data-video-key");
          const video = bySourceId[key];
          if (!video) return;
          slot.outerHTML =
            '<a class="follow-video" href="https://www.youtube.com/watch?v=' + video.video_id + '" target="_blank" rel="noopener">' +
              '<img class="follow-video-thumb" src="' + video.thumbnail_url + '" alt="" loading="lazy">' +
              '<div class="follow-video-text">' +
                '<p class="follow-video-label">Latest video</p>' +
                '<p class="follow-video-title">' + video.title + '</p>' +
              '</div>' +
            '</a>';
        });
      })
      .catch(function () {
        // Query failed — cards just show without a preview.
      });
  }
})();