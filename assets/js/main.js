/* Barzin Mobasher Research Group — site behaviors (no dependencies) */
(function () {
  "use strict";

  /* Mobile nav toggle */
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.querySelector(".main-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  /* Dropdown navigation: click/keyboard on the caret, Escape closes */
  var subs = document.querySelectorAll(".nav-item.has-sub");
  subs.forEach(function (item) {
    var btn = item.querySelector(".sub-toggle");
    if (!btn) return;
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      var wasOpen = item.classList.contains("open");
      subs.forEach(function (o) {
        o.classList.remove("open");
        var b = o.querySelector(".sub-toggle");
        if (b) b.setAttribute("aria-expanded", "false");
      });
      if (!wasOpen) {
        item.classList.add("open");
        btn.setAttribute("aria-expanded", "true");
      }
    });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    subs.forEach(function (o) {
      o.classList.remove("open");
      var b = o.querySelector(".sub-toggle");
      if (b) b.setAttribute("aria-expanded", "false");
    });
  });
  document.addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest(".nav-item.has-sub")) return;
    subs.forEach(function (o) {
      o.classList.remove("open");
      var b = o.querySelector(".sub-toggle");
      if (b) b.setAttribute("aria-expanded", "false");
    });
  });

  /* Prototype ribbon dismiss */
  var ribbon = document.querySelector(".proto-ribbon");
  if (ribbon) {
    if (sessionStorage.getItem("protoRibbonDismissed") === "1") {
      ribbon.style.display = "none";
    }
    var close = ribbon.querySelector("button");
    if (close) {
      close.addEventListener("click", function () {
        ribbon.style.display = "none";
        sessionStorage.setItem("protoRibbonDismissed", "1");
      });
    }
  }

  /* Accordions: wire aria-controls ids, toggle state */
  var accIndex = 0;
  document.querySelectorAll(".accordion").forEach(function (acc) {
    var btn = acc.querySelector(":scope > button");
    var body = acc.querySelector(".acc-body");
    if (!btn || !body) return;
    accIndex += 1;
    if (!body.id) body.id = "acc-body-" + accIndex;
    btn.setAttribute("aria-controls", body.id);
    if (!btn.hasAttribute("aria-expanded")) btn.setAttribute("aria-expanded", "false");
    btn.addEventListener("click", function () {
      var open = acc.classList.toggle("open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
  });

  /* Unified filtering: one state per chip group so search and chips compose */
  document.querySelectorAll("[data-chipgroup]").forEach(function (group) {
    var targetSel = group.getAttribute("data-target");
    var target = document.querySelector(targetSel);
    if (!target) return;
    var items = target.querySelectorAll(".filterable");
    var search = document.querySelector(".pub-search");
    var counter = document.querySelector("[data-count]");
    var noResults = document.querySelector("[data-noresults]");
    var state = { cat: "all", q: "" };

    function apply() {
      var shown = 0;
      items.forEach(function (it) {
        var okCat = state.cat === "all" || it.getAttribute("data-cat") === state.cat;
        var hay = (it.getAttribute("data-search") || it.textContent).toLowerCase();
        var okQ = !state.q || hay.indexOf(state.q) !== -1;
        var show = okCat && okQ;
        it.style.display = show ? "" : "none";
        if (show) shown += 1;
      });
      document.querySelectorAll("[data-yeargroup]").forEach(function (g) {
        var any = Array.prototype.some.call(
          g.querySelectorAll(".filterable"),
          function (it) { return it.style.display !== "none"; }
        );
        g.style.display = any ? "" : "none";
      });
      if (counter) counter.textContent = "Showing " + shown + " of " + items.length;
      if (noResults) noResults.hidden = shown !== 0;
    }

    group.querySelectorAll(".chip").forEach(function (chip) {
      if (!chip.hasAttribute("aria-pressed")) {
        chip.setAttribute("aria-pressed", chip.classList.contains("active") ? "true" : "false");
      }
      chip.addEventListener("click", function () {
        group.querySelectorAll(".chip").forEach(function (c) {
          c.classList.remove("active");
          c.setAttribute("aria-pressed", "false");
        });
        chip.classList.add("active");
        chip.setAttribute("aria-pressed", "true");
        state.cat = chip.getAttribute("data-filter");
        apply();
      });
    });

    if (search) {
      search.addEventListener("input", function () {
        state.q = search.value.trim().toLowerCase();
        apply();
      });
    }

    /* Deep link: /videos.html#Lab%20Testing activates the matching chip */
    if (location.hash.length > 1) {
      var want = decodeURIComponent(location.hash.slice(1)).toLowerCase();
      group.querySelectorAll(".chip").forEach(function (chip) {
        if (chip.getAttribute("data-filter").toLowerCase() === want) chip.click();
      });
    }

    apply();
  });

  /* Copy buttons (BibTeX, citation) with honest fallback */
  var live = document.createElement("span");
  live.className = "sr-only";
  live.setAttribute("role", "status");
  document.body.appendChild(live);

  document.querySelectorAll("[data-copy]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var el = document.querySelector(btn.getAttribute("data-copy"));
      if (!el) return;
      var text = el.textContent;
      function done() {
        var old = btn.textContent;
        btn.textContent = "Copied";
        live.textContent = "Copied to clipboard";
        setTimeout(function () { btn.textContent = old; live.textContent = ""; }, 1600);
      }
      function fallback() {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.top = "0";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        var ok = false;
        try { ok = document.execCommand("copy"); } catch (e) { /* no-op */ }
        document.body.removeChild(ta);
        if (ok) { done(); return; }
        btn.textContent = "Press Ctrl+C";
        var sel = window.getSelection();
        sel.removeAllRanges();
        var range = document.createRange();
        range.selectNodeContents(el);
        sel.addRange(range);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, fallback);
      } else {
        fallback();
      }
    });
  });

  /* Click-to-load YouTube embeds. Slot needs data-yt="VIDEOID". */
  document.querySelectorAll(".video-slot[data-yt]").forEach(function (slot) {
    var id = slot.getAttribute("data-yt");
    if (!id) return;
    var btn = slot.querySelector("button.play-load");
    if (!btn) return;
    btn.addEventListener("click", function () {
      /* YouTube refuses to embed on a page opened from a file (Error 153),
         so a copy viewed straight from the folder opens the video on YouTube. */
      if (location.protocol === "file:") {
        window.open("https://www.youtube.com/watch?v=" + encodeURIComponent(id), "_blank", "noopener");
        return;
      }
      var iframe = document.createElement("iframe");
      iframe.src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(id) + "?autoplay=1";
      iframe.title = slot.getAttribute("data-title") || "Video";
      iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
      iframe.allowFullscreen = true;
      slot.innerHTML = "";
      slot.appendChild(iframe);
      iframe.focus();
    });
  });

})();
