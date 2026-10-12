/* Social dashboard.
 * Reads the platform export files in data/<platform>/ (CSV or Excel), works out what each
 * column means from its header, rolls everything up into Monday-start weeks, and draws it.
 * Nothing is stored anywhere else: the export files in the repository are the data.
 * The client name and platform list come from config.js. */
(function () {
  "use strict";

  var CFG = window.DASHBOARD_CONFIG || {};
  var PLATFORMS = CFG.platforms || [
    { id: "instagram", name: "Instagram" },
    { id: "facebook", name: "Facebook" },
    { id: "linkedin", name: "LinkedIn" },
    { id: "tiktok", name: "TikTok" }
  ];
  var PNAME = {}, SLOT = {};
  // Colours follow the platform's position in the list (slots 1-4), so any four platforms work.
  PLATFORMS.forEach(function (p, i) { PNAME[p.id] = p.name; SLOT[p.id] = (i % 4) + 1; });
  function color(id) { return "var(--s" + SLOT[id] + ")"; }
  var CLIENT = CFG.clientName || "Logo Lads";
  document.title = CLIENT + " Social";
  document.getElementById("title").textContent = CLIENT + " · Social Dashboard";
  var FILE_RE = /\.(csv|xlsx|xls)$/i;
  var SUM_METRICS = ["newFollowers", "reach", "impressions", "engagements", "likes", "comments", "shares", "saves", "clicks", "profileVisits"];
  var MAIN_METRICS = [
    { id: "engagements", label: "Engagements", title: "Weekly engagements by platform" },
    { id: "reach", label: "Reach", title: "Weekly reach by platform" },
    { id: "impressions", label: "Views", title: "Weekly impressions / views by platform" },
    { id: "newFollowers", label: "New followers", title: "Net new followers per week" },
    { id: "followers", label: "Followers", title: "Total followers at end of week" },
    { id: "engRate", label: "Eng. rate", title: "Weekly engagement rate by platform", rate: true }
  ];

  var state = {
    daily: {},      // "platform|YYYY-MM-DD|metric" -> number
    posts: {},      // dedupe key -> post
    manual: {},     // "platform|weekStart|metric" -> number
    files: [],      // { path, platform, ok, note }
    previewCount: 0,
    weeksBack: 12,
    metric: "engagements",
    postPlatform: "all",
    postSort: "engagements"
  };

  // ---------- small helpers ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function isoLocal(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function isoUTC(d) { return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()); }
  function dateFromISO(s) { var p = s.split("-"); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function addDays(s, n) { var d = dateFromISO(s); d.setUTCDate(d.getUTCDate() + n); return isoUTC(d); }
  function weekStart(s) { var d = dateFromISO(s); var dow = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dow); return isoUTC(d); }
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function shortDate(s) { var d = dateFromISO(s); return MON[d.getUTCMonth()] + " " + d.getUTCDate(); }
  function longDate(s) { var d = dateFromISO(s); return MON[d.getUTCMonth()] + " " + d.getUTCDate() + ", " + d.getUTCFullYear(); }
  function todayISO() { return isoLocal(new Date()); }
  function daysBetween(a, b) { return Math.round((dateFromISO(b) - dateFromISO(a)) / 86400000); }

  function fmt(n) {
    if (n == null || isNaN(n)) return "–";
    var a = Math.abs(n);
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
    if (a >= 1e4) return (n / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, "") + "K";
    return Math.round(n).toLocaleString();
  }
  function fmtRate(r) { return r == null || isNaN(r) ? "–" : (r * 100).toFixed(r < 0.1 ? 2 : 1) + "%"; }

  function norm(h) { return String(h == null ? "" : h).toLowerCase().replace(/[ _]/g, " ").replace(/\s+/g, " ").trim(); }

  function parseNum(v) {
    if (v == null) return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    var s = String(v).trim().replace(/[,\s]/g, "");
    if (!s || s === "-" || s === "--" || /%$/.test(s)) return null;
    var mult = 1;
    if (/k$/i.test(s)) { mult = 1e3; s = s.slice(0, -1); }
    else if (/m$/i.test(s)) { mult = 1e6; s = s.slice(0, -1); }
    var n = Number(s);
    return isFinite(n) ? n * mult : null;
  }

  function parseDate(v) {
    if (v == null || v === "") return null;
    var d;
    if (v instanceof Date) return isNaN(v) ? null : isoLocal(v);
    if (typeof v === "number") {
      if (v > 20000 && v < 80000) { d = new Date(Math.round((v - 25569) * 86400000)); return isoUTC(d); }
      return null;
    }
    var s = String(v).trim();
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (m) return m[1] + "-" + pad(+m[2]) + "-" + pad(+m[3]);
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s);
    if (m) { var y = +m[3]; if (y < 100) y += 2000; return y + "-" + pad(+m[1]) + "-" + pad(+m[2]); }
    if (!/[a-z]/i.test(s) && !/\d{4}/.test(s)) return null;
    if (!/\d{4}/.test(s)) {
      // Year-less dates like "September 1" (TikTok): assume the most recent such date before today.
      // Exports end yesterday at the latest, so today's or a later date belongs to last year.
      var now = new Date();
      d = new Date(s + " " + now.getFullYear());
      if (isNaN(d)) return null;
      if (isoLocal(d) >= isoLocal(now)) d.setFullYear(d.getFullYear() - 1);
      return isoLocal(d);
    }
    d = new Date(s.replace(/(\d)(st|nd|rd|th)\b/, "$1"));
    if (isNaN(d) || d.getFullYear() < 2010 || d.getFullYear() > 2100) return null;
    return isoLocal(d);
  }

  // ---------- understanding export columns ----------
  var DATE_HEADERS = ["publish time", "video publish time", "post publish date", "publish date", "post time", "posted on", "created date", "date posted", "post date", "date created", "published", "posted", "created", "date", "day", "time"];
  var LINK_RE = /permalink|post link|video link|post url|^link$|^url$|share link/;
  var POST_TITLE_RE = /video title|post title/; // a posts table even without a link column (YouTube)
  var TITLE_RE = /title|description|caption|^post$|^content$|^update$/;
  var TYPE_RE = /post type|media type|content type|^type$|format/;

  function classify(h) {
    if (!h) return null;
    if (/rate|ctr|%|percent|average|avg|duration|watch time|unfollow|lost|id$|^id|name$|username/.test(h)) return null;
    if (/profile (views|visits|activity)|page (views|visits)|visitors|profile visits/.test(h)) return "profileVisits";
    if (/difference in followers|new follow|net follow|followers gained|organic followers|sponsored followers|auto-invited followers|^follows$|follows \(/.test(h)) return "newFollowers";
    if (/^subscribers( gained)?$|net subscribers/.test(h)) return "newFollowers"; // YouTube: net subscriber change
    if (/followers/.test(h)) return "followers";
    if (/unique impressions|reach|accounts reached|viewers/.test(h)) return "reach"; // Meta renamed reach to "Viewers"
    if (/impressions|views|plays/.test(h)) return "impressions";
    if (/^(total )?(engagements?|interactions|content interactions)( \(total\))?$/.test(h)) return "engagements";
    if (/likes|reactions/.test(h)) return "likes";
    if (/comments/.test(h)) return "comments";
    if (/shares|reposts/.test(h)) return "shares";
    if (/saves/.test(h)) return "saves";
    if (/clicks/.test(h)) return "clicks";
    return null;
  }
  // Meta Business Suite overview exports have one value column called "Primary";
  // the metric is named in the file name or the line above the header.
  function classifyContext(ctx) {
    ctx = norm(ctx);
    if (/visit/.test(ctx)) return "profileVisits";
    if (/follows|new follow/.test(ctx)) return "newFollowers";
    if (/follower/.test(ctx)) return "followers";
    if (/reach|viewer/.test(ctx)) return "reach"; // Meta renamed reach to "Viewers"
    if (/view|impression|play/.test(ctx)) return "impressions";
    if (/interaction|engagement/.test(ctx)) return "engagements";
    if (/link click|click/.test(ctx)) return "clicks";
    return null;
  }

  function findHeader(rows) {
    for (var i = 0; i < Math.min(rows.length, 15); i++) {
      var r = rows[i] || [];
      var filled = r.filter(function (c) { return c != null && String(c).trim() !== ""; });
      if (filled.length < 2) continue;
      var hs = r.map(norm);
      if (hs.some(function (h) { return DATE_HEADERS.indexOf(h) >= 0 || /\bdate\b/.test(h); })) return i;
    }
    return -1;
  }

  function pickCol(headers, list) {
    for (var i = 0; i < list.length; i++) {
      var idx = headers.indexOf(list[i]);
      if (idx >= 0) return idx;
    }
    for (i = 0; i < headers.length; i++) if (/\bdate\b/.test(headers[i])) return i;
    return -1;
  }

  // Returns { daily: n, posts: n } counts of what was taken from this table.
  function parseTable(rows, context, platform, sink) {
    var hi = findHeader(rows);
    if (hi < 0) return { daily: 0, posts: 0 };
    var headers = (rows[hi] || []).map(norm);

    // Side-by-side tables (LinkedIn personal "Top posts": one ranked by engagements, one by impressions):
    // split at each link column and read each half on its own.
    var linkCols = [];
    headers.forEach(function (h, i) { if (LINK_RE.test(h)) linkCols.push(i); });
    if (linkCols.length > 1) {
      var tot = { daily: 0, posts: 0 };
      linkCols.forEach(function (start, k) {
        var end = k + 1 < linkCols.length ? linkCols[k + 1] : undefined;
        var res = parseTable(rows.map(function (r) { return (r || []).slice(start, end); }), context, platform, sink);
        tot.daily += res.daily; tot.posts += res.posts;
      });
      return tot;
    }

    // "Total followers on 10/10/2026:" above the header (LinkedIn personal): a follower total for that date.
    var extra = 0;
    rows.slice(0, hi).forEach(function (r) {
      r = r || [];
      r.forEach(function (c, i) {
        var mm = /total followers on (.+?):?\s*$/i.exec(String(c || ""));
        if (!mm) return;
        var fd = parseDate(mm[1]), fv = parseNum(r[i + 1]);
        if (fd && fv != null) { sink.daily[platform + "|" + fd + "|followers"] = fv; extra++; }
      });
    });

    var ctx = context + " " + rows.slice(0, hi).map(function (r) { return (r || []).join(" "); }).join(" ");
    var isYouTube = headers.some(function (h) { return /watch time|subscribers/.test(h); });
    var isPosts = headers.some(function (h) { return LINK_RE.test(h) || POST_TITLE_RE.test(h); });
    var dateCol = pickCol(headers, isPosts ? DATE_HEADERS : ["date", "day", "time", "date posted"]);
    if (dateCol < 0) return { daily: 0, posts: 0 };

    // Column -> metric. When a "(total)" column exists, its organic/sponsored parts are skipped.
    var bases = {};
    headers.forEach(function (h) { var b = h.replace(/\((organic|sponsored|paid|total)\)/, "").trim(); if (/\(total\)/.test(h)) bases[b] = true; });
    var hasSplitFollowers = headers.some(function (h) { return /organic followers|sponsored followers/.test(h); });
    var map = [];
    headers.forEach(function (h, i) {
      if (i === dateCol) return;
      var b = h.replace(/\((organic|sponsored|paid|total)\)/, "").trim();
      if (bases[b] && !/\(total\)/.test(h)) return;
      var m;
      if (h === "primary" || h === "value") m = classifyContext(ctx);
      else if (hasSplitFollowers && /total followers/.test(h)) m = null; // daily total of new followers, already summed from the parts
      else m = classify(h);
      if (m) map.push([i, m]);
    });
    // YouTube "Impressions" are thumbnail impressions, not views: use its Views column instead.
    if (isYouTube) map = map.filter(function (cm) { return !/impressions/.test(headers[cm[0]]); });
    // LinkedIn posts report "Impressions" plus video "Views": count impressions only, don't add them up.
    if (map.some(function (cm) { return cm[1] === "impressions" && /impressions/.test(headers[cm[0]]); }))
      map = map.filter(function (cm) { return cm[1] !== "impressions" || /impressions/.test(headers[cm[0]]); });

    var count = 0;
    if (isPosts) {
      var linkCol = headers.findIndex(function (h) { return LINK_RE.test(h); });
      var titleCol = headers.findIndex(function (h, i) { return i !== linkCol && /title/.test(h); });
      if (titleCol < 0) titleCol = headers.findIndex(function (h, i) { return i !== linkCol && TITLE_RE.test(h); });
      var typeCol = headers.findIndex(function (h) { return TYPE_RE.test(h); });
      var idCol = isYouTube ? headers.indexOf("content") : -1; // YouTube video ID
      for (var r = hi + 1; r < rows.length; r++) {
        var row = rows[r] || [];
        var date = parseDate(row[dateCol]);
        if (!date) continue;
        var link = linkCol >= 0 ? String(row[linkCol] || "") : "";
        if (!link && idCol >= 0 && /^[\w-]{11}$/.test(String(row[idCol] || ""))) link = "https://youtu.be/" + row[idCol];
        var post = { platform: platform, date: date, link: link, title: titleCol >= 0 ? String(row[titleCol] || "") : "", type: typeCol >= 0 ? String(row[typeCol] || "") : "" };
        map.forEach(function (cm) {
          var v = parseNum(row[cm[0]]);
          if (v != null && cm[1] !== "followers") post[cm[1]] = (post[cm[1]] || 0) + v;
        });
        if (post.engagements == null) {
          var e = ["likes", "comments", "shares", "saves"].reduce(function (s, k) { return s + (post[k] || 0); }, 0);
          if (["likes", "comments", "shares", "saves"].some(function (k) { return post[k] != null; })) post.engagements = e;
        }
        var key = platform + "|" + (post.link || post.date + "|" + post.title.slice(0, 60));
        // The same post can appear in several tables (e.g. one with engagements, one with impressions): merge them.
        var prev = sink.posts[key];
        if (prev) Object.keys(post).forEach(function (k) { if (post[k] != null && post[k] !== "") prev[k] = post[k]; });
        else sink.posts[key] = post;
        count++;
      }
      return { daily: extra, posts: count };
    }

    if (!map.length) return { daily: extra, posts: 0 };
    for (var rr = hi + 1; rr < rows.length; rr++) {
      var row2 = rows[rr] || [];
      var d = parseDate(row2[dateCol]);
      if (!d) continue;
      var acc = {};
      map.forEach(function (cm) {
        var v = parseNum(row2[cm[0]]);
        if (v != null) acc[cm[1]] = (acc[cm[1]] || 0) + v;
      });
      Object.keys(acc).forEach(function (m) { sink.daily[platform + "|" + d + "|" + m] = acc[m]; count++; });
    }
    return { daily: count + extra, posts: 0 };
  }

  function parseManual(rows, sink) {
    var headers = (rows[0] || []).map(norm);
    var wi = headers.indexOf("week start"), pi = headers.indexOf("platform");
    if (wi < 0 || pi < 0) return 0;
    var cols = { followers: "followers", "new followers": "newFollowers", reach: "reach", impressions: "impressions", views: "impressions", engagements: "engagements", posts: "posts" };
    var n = 0;
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r] || [];
      var d = parseDate(row[wi]); var p = norm(row[pi]);
      if (!d || !PNAME[p]) continue;
      headers.forEach(function (h, i) {
        var m = cols[h]; if (!m) return;
        var v = parseNum(row[i]);
        if (v != null) { sink.manual[p + "|" + weekStart(d) + "|" + m] = v; n++; }
      });
    }
    return n;
  }

  function decodeText(buf) {
    var b = new Uint8Array(buf);
    var enc = "utf-8";
    if (b[0] === 0xff && b[1] === 0xfe) enc = "utf-16le";
    else if (b[0] === 0xfe && b[1] === 0xff) enc = "utf-16be";
    var text = new TextDecoder(enc).decode(buf).replace(/^﻿/, "");
    return text.replace(/^sep=.\r?\n/i, "");
  }

  function parseFile(buf, name, platform) {
    var wb = /\.csv$/i.test(name)
      ? XLSX.read(decodeText(buf), { type: "string", raw: true })
      : XLSX.read(buf, { type: "array", cellDates: true });
    var total = { daily: 0, posts: 0, manual: 0 };
    wb.SheetNames.forEach(function (sn) {
      var rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: null, blankrows: false });
      if (platform === "manual") { total.manual += parseManual(rows, state); return; }
      var r = parseTable(rows, name + " " + sn, platform, state);
      total.daily += r.daily; total.posts += r.posts;
    });
    return total;
  }

  function describeResult(res) {
    var bits = [];
    if (res.daily) bits.push(res.daily + " daily values");
    if (res.posts) bits.push(res.posts + " posts");
    if (res.manual) bits.push(res.manual + " manual values");
    return bits.join(", ");
  }

  // ---------- finding the files ----------
  function repoInfo() {
    if (CFG.githubOwner && CFG.githubRepo) return { owner: CFG.githubOwner, repo: CFG.githubRepo };
    var host = location.hostname;
    if (/\.github\.io$/.test(host)) {
      var owner = host.split(".")[0];
      var first = location.pathname.split("/").filter(Boolean)[0];
      return { owner: owner, repo: first && !/\.html$/.test(first) ? first : host };
    }
    return null;
  }

  function listFiles() {
    var info = repoInfo();
    var branch = CFG.branch || "main";
    if (info) {
      var api = "https://api.github.com/repos/" + info.owner + "/" + info.repo + "/git/trees/" + branch + "?recursive=1";
      return fetch(api, { cache: "no-store" }).then(function (r) {
        if (!r.ok) throw new Error("GitHub said " + r.status + " when listing the data folder" + (r.status === 403 ? " (too many page loads in the last hour; wait a bit and refresh)" : ""));
        return r.json();
      }).then(function (j) {
        return j.tree.filter(function (t) { return t.type === "blob" && /^data\//.test(t.path) && FILE_RE.test(t.path); }).map(function (t) {
          return { path: t.path, url: "https://raw.githubusercontent.com/" + info.owner + "/" + info.repo + "/" + branch + "/" + t.path.split("/").map(encodeURIComponent).join("/") };
        });
      });
    }
    // Local preview: read the web server's folder listings.
    var folders = PLATFORMS.map(function (p) { return p.id; }).concat(["manual"]);
    return Promise.all(folders.map(function (f) {
      return fetch("data/" + f + "/", { cache: "no-store" }).then(function (r) { return r.ok ? r.text() : ""; }).catch(function () { return ""; }).then(function (html) {
        var out = [], re = /href="([^"?#]+)"/gi, m;
        while ((m = re.exec(html))) {
          var name = decodeURIComponent(m[1].split("/").pop());
          if (FILE_RE.test(name)) out.push({ path: "data/" + f + "/" + name, url: "data/" + f + "/" + encodeURIComponent(name) });
        }
        return out;
      });
    })).then(function (lists) { return [].concat.apply([], lists); });
  }

  function load() {
    listFiles().then(function (files) {
      // Sorted by path so a later-named file (e.g. "2026-10-05 Overview.csv") wins where dates overlap.
      files.sort(function (a, b) { return a.path < b.path ? -1 : 1; });
      return files.reduce(function (chain, f) {
        return chain.then(function () {
          var platform = f.path.split("/")[1];
          if (!PNAME[platform] && platform !== "manual") return;
          return fetch(f.url, { cache: "no-store" }).then(function (r) {
            if (!r.ok) throw new Error("download failed (" + r.status + ")");
            return r.arrayBuffer();
          }).then(function (buf) {
            var res = parseFile(buf, f.path.split("/").pop(), platform);
            var got = describeResult(res);
            // An empty manual sheet is normal, not an error.
            state.files.push({ path: f.path, platform: platform, ok: !!got || platform === "manual", note: got || "no dates or recognisable columns found" });
          }).catch(function (e) {
            state.files.push({ path: f.path, platform: platform, ok: false, note: e.message });
          });
        });
      }, Promise.resolve());
    }).then(render, function (e) {
      $("subtitle").textContent = "Couldn't load data: " + e.message;
      render();
    });
  }

  // ---------- rolling up into weeks ----------
  function buildWeekly() {
    var W = {}; // platform -> week -> row
    function row(p, w) { W[p] = W[p] || {}; return (W[p][w] = W[p][w] || { followersDate: null }); }
    var hasDaily = {}; // "platform|metric" -> true when daily exports cover it
    Object.keys(state.daily).forEach(function (k) {
      var parts = k.split("|"), p = parts[0], d = parts[1], m = parts[2], v = state.daily[k];
      var r = row(p, weekStart(d));
      if (m === "followers") { if (!r.followersDate || d > r.followersDate) { r.followers = v; r.followersDate = d; } }
      else r[m] = (r[m] || 0) + v;
    });
    // Engagements from parts where no total was reported.
    Object.keys(W).forEach(function (p) {
      Object.keys(W[p]).forEach(function (w) {
        var r = W[p][w];
        if (r.engagements == null && ["likes", "comments", "shares", "saves"].some(function (k) { return r[k] != null; }))
          r.engagements = (r.likes || 0) + (r.comments || 0) + (r.shares || 0) + (r.saves || 0);
        ["engagements", "reach", "impressions"].forEach(function (m) { if (r[m] != null) hasDaily[p + "|" + m] = true; });
      });
    });
    // Posts: count per week, and stand in for daily totals a platform's exports don't have.
    var fallback = {};
    Object.keys(state.posts).forEach(function (k) {
      var post = state.posts[k], r = row(post.platform, weekStart(post.date));
      r.posts = (r.posts || 0) + 1;
      ["engagements", "reach", "impressions"].forEach(function (m) {
        if (post[m] == null || hasDaily[post.platform + "|" + m]) return;
        r[m] = (r[m] || 0) + post[m];
        fallback[post.platform + "|" + m] = true;
      });
    });
    // Manual entries override anything computed.
    Object.keys(state.manual).forEach(function (k) {
      var parts = k.split("|"); row(parts[0], parts[1])[parts[2]] = state.manual[k];
    });
    // Net new followers from totals when the exports only give totals.
    Object.keys(W).forEach(function (p) {
      var weeks = Object.keys(W[p]).sort();
      weeks.forEach(function (w, i) {
        var r = W[p][w];
        if (r.newFollowers == null && r.followers != null && i > 0 && W[p][weeks[i - 1]].followers != null && daysBetween(weeks[i - 1], w) === 7)
          r.newFollowers = r.followers - W[p][weeks[i - 1]].followers;
        var denom = r.reach || r.impressions;
        r.engRate = r.engagements != null && denom ? r.engagements / denom : null;
      });
    });
    return { W: W, fallback: fallback };
  }

  function allWeeks(W) {
    var set = {};
    // Only weeks with real numbers count: a week that just has an old post in it (Matt's LinkedIn export
    // lists a 2012 post) must not stretch the timeline back years.
    Object.keys(W).forEach(function (p) {
      Object.keys(W[p]).forEach(function (w) {
        if (Object.keys(W[p][w]).some(function (k) { return k !== "posts" && k !== "followersDate" && W[p][w][k] != null; })) set[w] = true;
      });
    });
    var ws = Object.keys(set).sort();
    if (!ws.length) return [];
    var out = [], w = ws[0], last = ws[ws.length - 1];
    while (w <= last) { out.push(w); w = addDays(w, 7); }
    return out;
  }

  function sumRange(W, p, weeks, m) {
    var s = null;
    weeks.forEach(function (w) { var r = W[p] && W[p][w]; if (r && r[m] != null) s = (s || 0) + r[m]; });
    return s;
  }
  function lastIn(W, p, weeks, m) {
    for (var i = weeks.length - 1; i >= 0; i--) { var r = W[p] && W[p][weeks[i]]; if (r && r[m] != null) return r[m]; }
    return null;
  }
  function rateRange(W, ps, weeks) {
    var e = 0, d = 0;
    ps.forEach(function (p) {
      weeks.forEach(function (w) {
        var r = W[p] && W[p][w]; if (!r || r.engagements == null) return;
        var den = r.reach || r.impressions; if (!den) return;
        e += r.engagements; d += den;
      });
    });
    return d ? e / d : null;
  }

  // ---------- rendering ----------
  var model = null;

  function render() {
    model = buildWeekly();
    var W = model.W;
    var weeks = allWeeks(W);
    var n = state.weeksBack && state.weeksBack < weeks.length ? state.weeksBack : weeks.length;
    var cur = weeks.slice(weeks.length - n);
    var prev = state.weeksBack ? weeks.slice(Math.max(0, weeks.length - 2 * n), weeks.length - n) : [];
    if (prev.length < n) prev = [];
    model.weeks = weeks; model.cur = cur; model.prev = prev;

    var okFiles = state.files.filter(function (f) { return f.ok && f.platform !== "manual"; }).length;
    $("subtitle").textContent = weeks.length
      ? "Week of " + longDate(cur[0]) + " – week of " + longDate(cur[cur.length - 1]) + " · " + okFiles + " export files" + (state.previewCount ? " · including " + state.previewCount + " previewed files (not saved)" : "")
      : (state.files.length ? "No usable data found in the export files yet." : "No export files yet: upload them to the data folders.");

    renderFresh(W);
    renderWarnings();
    renderKpis(W, cur, prev);
    renderMain(W, cur);
    renderPlatforms(W, cur, prev);
    renderPosts(cur);
    renderWeekly(W, cur);
  }

  function renderFresh(W) {
    var today = todayISO(), stale = CFG.staleAfterDays || 10;
    $("fresh").innerHTML = PLATFORMS.map(function (p) {
      var latest = null;
      Object.keys(state.daily).forEach(function (k) { if (k.indexOf(p.id + "|") === 0) { var d = k.split("|")[1]; if (!latest || d > latest) latest = d; } });
      // A manual weekly row counts as data through the end of its week, but never past yesterday.
      var yesterday = addDays(today, -1);
      Object.keys(state.manual).forEach(function (k) { if (k.indexOf(p.id + "|") === 0) { var d = addDays(k.split("|")[1], 6); if (d > yesterday) d = yesterday; if (!latest || d > latest) latest = d; } });
      var latestPost = null;
      Object.keys(state.posts).forEach(function (k) { var po = state.posts[k]; if (po.platform === p.id && (!latestPost || po.date > latestPost)) latestPost = po.date; });
      var files = state.files.filter(function (f) { return f.platform === p.id && f.ok; }).length;
      var cls, icon, label;
      if (!latest && latestPost) { cls = "warning"; icon = "!"; label = "Posts export only · latest post " + shortDate(latestPost); }
      else if (!latest) { cls = "critical"; icon = "!"; label = "No data yet"; }
      else if (daysBetween(latest, today) > stale) { cls = "warning"; icon = "!"; label = "Out of date · through " + shortDate(latest); }
      else { cls = "good"; icon = "✓"; label = "Up to date · through " + shortDate(latest); }
      return '<div class="card item"><span class="icon" style="background:var(--' + cls + ')" aria-hidden="true">' + icon + '</span><div><div class="name">' + p.name + '</div><div class="when">' + label + (files ? " · " + files + " file" + (files > 1 ? "s" : "") : "") + "</div></div></div>";
    }).join("");
  }

  function renderWarnings() {
    var bad = state.files.filter(function (f) { return !f.ok; });
    $("warnings").innerHTML = bad.length
      ? '<div class="card warnlist"><b>' + bad.length + " file" + (bad.length > 1 ? "s" : "") + " couldn't be read</b><ul>" + bad.map(function (f) { return "<li>" + esc(f.path) + ": " + esc(f.note) + "</li>"; }).join("") + "</ul></div>"
      : "";
  }

  function deltaHTML(curV, prevV, isRate) {
    if (curV == null || prevV == null || !state.weeksBack) return '<div class="delta">&nbsp;</div>';
    var label = "vs prior " + state.weeksBack + " wks";
    if (isRate) {
      var pts = (curV - prevV) * 100;
      return '<div class="delta ' + (pts > 0 ? "up" : pts < 0 ? "down" : "") + '">' + (pts > 0 ? "▲ " : pts < 0 ? "▼ " : "") + Math.abs(pts).toFixed(1) + " pts " + label + "</div>";
    }
    if (!prevV) return '<div class="delta">&nbsp;</div>';
    var pct = (curV - prevV) / Math.abs(prevV) * 100;
    return '<div class="delta ' + (pct > 0 ? "up" : pct < 0 ? "down" : "") + '">' + (pct > 0 ? "▲ " : pct < 0 ? "▼ " : "") + Math.abs(pct).toFixed(0) + "% " + label + "</div>";
  }

  function renderKpis(W, cur, prev) {
    var ids = PLATFORMS.map(function (p) { return p.id; });
    function total(fn, weeks) { var s = null; ids.forEach(function (p) { var v = fn(p, weeks); if (v != null) s = (s || 0) + v; }); return s; }
    var fol = total(function (p, w) { return lastIn(W, p, w, "followers"); }, cur);
    var folPrev = prev.length ? total(function (p, w) { return lastIn(W, p, w, "followers"); }, prev) : null;
    // Say which platforms the total covers until every platform with data has a follower count.
    var withData = ids.filter(function (p) { return cur.some(function (w) { return W[p] && W[p][w]; }); });
    var withTotals = withData.filter(function (p) { return lastIn(W, p, cur, "followers") != null; });
    var folNote = withTotals.length && withTotals.length < withData.length
      ? withTotals.map(function (p) { return PNAME[p]; }).join(" + ") + " only" : null;
    var tiles = [
      { label: "Total followers", v: fol, p: folPrev, f: fmt, note: folNote },
      { label: "Net new followers", v: total(function (p, w) { return sumRange(W, p, w, "newFollowers"); }, cur), p: prev.length ? total(function (p, w) { return sumRange(W, p, w, "newFollowers"); }, prev) : null, f: function (n) { return n == null ? "–" : (n > 0 ? "+" : "") + fmt(n); } },
      { label: "Reach", v: total(function (p, w) { return sumRange(W, p, w, "reach"); }, cur), p: prev.length ? total(function (p, w) { return sumRange(W, p, w, "reach"); }, prev) : null, f: fmt },
      { label: "Impressions / views", v: total(function (p, w) { return sumRange(W, p, w, "impressions"); }, cur), p: prev.length ? total(function (p, w) { return sumRange(W, p, w, "impressions"); }, prev) : null, f: fmt },
      { label: "Engagements", v: total(function (p, w) { return sumRange(W, p, w, "engagements"); }, cur), p: prev.length ? total(function (p, w) { return sumRange(W, p, w, "engagements"); }, prev) : null, f: fmt },
      { label: "Engagement rate", v: rateRange(W, ids, cur), p: prev.length ? rateRange(W, ids, prev) : null, f: fmtRate, rate: true }
    ];
    $("kpis").innerHTML = tiles.map(function (t) {
      return '<div class="card kpi"><div class="label">' + t.label + '</div><div class="value">' + t.f(t.v) + "</div>" + (t.note ? '<div class="delta">' + esc(t.note) + "</div>" : deltaHTML(t.v, t.p, t.rate)) + "</div>";
    }).join("");
  }

  function renderMain(W, cur) {
    var mdef = MAIN_METRICS.filter(function (m) { return m.id === state.metric; })[0];
    $("metric").innerHTML = MAIN_METRICS.map(function (m) { return '<button data-m="' + m.id + '" aria-pressed="' + (m.id === state.metric) + '">' + m.label + "</button>"; }).join("");
    $("mainTitle").textContent = mdef.title;
    var series = PLATFORMS.map(function (p) {
      return { id: p.id, name: p.name, color: color(p.id), values: cur.map(function (w) { var r = W[p.id] && W[p.id][w]; return r && r[mdef.id] != null ? r[mdef.id] : null; }) };
    }).filter(function (s) { return s.values.some(function (v) { return v != null; }); });
    $("legend").innerHTML = series.map(function (s) { return '<span style="--c:' + s.color + '">' + s.name + "</span>"; }).join("");
    lineChart($("mainChart"), { weeks: cur, series: series, height: 300, format: mdef.rate ? fmtRate : fmt, directLabels: series.length <= 4 });
  }

  function renderPlatforms(W, cur, prev) {
    var el = $("platforms");
    el.innerHTML = PLATFORMS.map(function (p) {
      return '<div class="card plat" style="--c:' + color(p.id) + '"><h3><i></i>' + p.name + '</h3><div class="stats" id="st-' + p.id + '"></div><div class="chart" id="pc-' + p.id + '"></div><div class="cap" id="cap-' + p.id + '"></div></div>';
    }).join("");
    PLATFORMS.forEach(function (p) {
      var id = p.id;
      var stats = [
        { l: "Followers", v: lastIn(W, id, cur, "followers"), pv: prev.length ? lastIn(W, id, prev, "followers") : null, f: fmt },
        { l: "Reach", v: sumRange(W, id, cur, "reach"), pv: prev.length ? sumRange(W, id, prev, "reach") : null, f: fmt },
        { l: "Engagements", v: sumRange(W, id, cur, "engagements"), pv: prev.length ? sumRange(W, id, prev, "engagements") : null, f: fmt },
        { l: "Eng. rate", v: rateRange(W, [id], cur), pv: prev.length ? rateRange(W, [id], prev) : null, f: fmtRate, rate: true }
      ];
      if (stats[1].v == null) { stats[1] = { l: "Views", v: sumRange(W, id, cur, "impressions"), pv: prev.length ? sumRange(W, id, prev, "impressions") : null, f: fmt }; }
      $("st-" + id).innerHTML = stats.map(function (s) {
        return '<div><div class="l">' + s.l + '</div><div class="v">' + s.f(s.v) + "</div>" + deltaHTML(s.v, s.pv, s.rate).replace('class="delta', 'class="d delta').replace(/ vs prior \d+ wks/, "") + "</div>";
      }).join("");
      var useTotals = cur.some(function (w) { return W[id] && W[id][w] && W[id][w].followers != null; });
      var metric = useTotals ? "followers" : "newFollowers";
      var vals = cur.map(function (w) { var r = W[id] && W[id][w]; return r && r[metric] != null ? r[metric] : null; });
      lineChart($("pc-" + id), { empty: "No follower numbers yet. Add the follower export, or weekly totals in the manual sheet.", weeks: cur, series: [{ id: id, name: useTotals ? "Followers" : "New followers", color: color(id), values: vals }], height: 140, format: fmt, compact: true });
      var notes = [useTotals ? "Followers at end of each week." : "New followers per week."], fromPosts = [];
      ["engagements", "reach", "impressions"].forEach(function (m) { if (model.fallback[id + "|" + m]) fromPosts.push(m === "impressions" ? "views" : m); });
      if (fromPosts.length) notes.push("From the posts export (totals for posts published that week): " + fromPosts.join(", ") + ".");
      $("cap-" + id).textContent = notes.join(" ");
    });
  }

  var POST_COLS = [
    { k: "date", l: "Date" }, { k: "platform", l: "Platform" }, { k: "title", l: "Post" },
    { k: "reach", l: "Reach", n: true }, { k: "impressions", l: "Views", n: true },
    { k: "likes", l: "Likes", n: true }, { k: "comments", l: "Comments", n: true }, { k: "shares", l: "Shares", n: true },
    { k: "engagements", l: "Engagements", n: true }
  ];
  // LinkedIn personal exports have no post text, but post links carry a slug, e.g.
  // linkedin.com/posts/matthew-atkins-a3b19830_the-future-of-indoor-golf-ugcPost-745… → "The future of indoor golf".
  function slugTitle(link) {
    var m = /linkedin\.com\/posts\/[^_\/]+_(.+?)-(?:share|ugcPost|activity)-\d/.exec(link || "");
    if (!m) return "";
    var t = m[1].replace(/-/g, " ").trim();
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
  }

  function renderPosts(cur) {
    $("postFilter").innerHTML = [{ id: "all", name: "All" }].concat(PLATFORMS).map(function (p) { return '<button data-p="' + p.id + '" aria-pressed="' + (p.id === state.postPlatform) + '">' + p.name + "</button>"; }).join("");
    if (!cur.length) { $("posts").innerHTML = '<div class="empty">No posts yet.</div>'; return; }
    var from = cur[0], to = addDays(cur[cur.length - 1], 6);
    var list = Object.keys(state.posts).map(function (k) { return state.posts[k]; }).filter(function (p) {
      return p.date >= from && p.date <= to && (state.postPlatform === "all" || p.platform === state.postPlatform);
    });
    var sk = state.postSort;
    list.sort(function (a, b) { return sk === "date" ? (a.date < b.date ? 1 : -1) : (b[sk] || 0) - (a[sk] || 0); });
    list = list.slice(0, 10);
    if (!list.length) { $("posts").innerHTML = '<div class="empty">No posts in this period. Upload each platform\'s content/posts export to fill this in.</div>'; return; }
    $("posts").innerHTML = "<table><thead><tr>" + POST_COLS.map(function (c) {
      var sortable = c.n || c.k === "date";
      return '<th class="' + (c.n ? "n " : "") + (sortable ? "sortable" : "") + '"' + (sortable ? ' data-sort="' + c.k + '"' : "") + ">" + c.l + (sortable && sk === c.k ? " ▾" : "") + "</th>";
    }).join("") + "</tr></thead><tbody>" + list.map(function (p) {
      var title = esc(p.title || p.type || slugTitle(p.link) || (p.link ? "View post" : "(untitled)"));
      return "<tr><td>" + shortDate(p.date) + '</td><td><span class="pill" style="--c:' + color(p.platform) + '">' + PNAME[p.platform] + '</span></td><td><div class="post-title">' +
        (p.link && /^https?:/.test(p.link) ? '<a href="' + esc(p.link) + '" target="_blank" rel="noopener">' + title + "</a>" : title) + "</div></td>" +
        POST_COLS.slice(3).map(function (c) { return '<td class="n">' + fmt(p[c.k]) + "</td>"; }).join("") + "</tr>";
    }).join("") + "</tbody></table>";
  }

  var WEEK_COLS = [
    { k: "followers", l: "Followers" }, { k: "newFollowers", l: "New followers" }, { k: "reach", l: "Reach" },
    { k: "impressions", l: "Views / impressions" }, { k: "engagements", l: "Engagements" }, { k: "engRate", l: "Eng. rate", rate: true }, { k: "posts", l: "Posts" }
  ];
  function weeklyRows(W, weeks) {
    var out = [];
    weeks.slice().reverse().forEach(function (w) {
      PLATFORMS.forEach(function (p) { var r = W[p.id] && W[p.id][w]; if (r) out.push({ week: w, platform: p, r: r }); });
    });
    return out;
  }
  function renderWeekly(W, cur) {
    var rows = weeklyRows(W, cur);
    $("weekly").innerHTML = rows.length ? "<table><thead><tr><th>Week of</th><th>Platform</th>" + WEEK_COLS.map(function (c) { return '<th class="n">' + c.l + "</th>"; }).join("") + "</tr></thead><tbody>" +
      rows.map(function (x) {
        return "<tr><td>" + longDate(x.week) + '</td><td><span class="pill" style="--c:' + color(x.platform.id) + '">' + x.platform.name + "</span></td>" +
          WEEK_COLS.map(function (c) { return '<td class="n">' + (c.rate ? fmtRate(x.r[c.k]) : fmt(x.r[c.k])) + "</td>"; }).join("") + "</tr>";
      }).join("") + "</tbody></table>" : '<div class="empty">Nothing yet.</div>';
  }

  function downloadCSV() {
    if (!model) return;
    var rows = weeklyRows(model.W, model.cur);
    var lines = [["Week of", "Platform"].concat(WEEK_COLS.map(function (c) { return c.l; })).join(",")];
    rows.forEach(function (x) {
      lines.push([x.week, x.platform.name].concat(WEEK_COLS.map(function (c) {
        var v = x.r[c.k]; return v == null ? "" : c.rate ? (v * 100).toFixed(2) + "%" : Math.round(v);
      })).join(","));
    });
    var blob = new Blob([lines.join("\n")], { type: "text/csv" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = CLIENT.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-weekly-" + todayISO() + ".csv";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // ---------- line chart (SVG) ----------
  var SVGNS = "http://www.w3.org/2000/svg";
  function niceMax(v) {
    if (v <= 0) return 1;
    var e = Math.pow(10, Math.floor(Math.log10(v))), f = v / e;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
  }
  function el(tag, attrs, parent) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function lineChart(host, o) {
    host.innerHTML = "";
    var vals = [];
    o.series.forEach(function (s) { s.values.forEach(function (v) { if (v != null) vals.push(v); }); });
    if (!o.weeks.length || !vals.length) { host.innerHTML = '<div class="empty"' + (o.compact ? ' style="padding:16px 0"' : "") + ">" + esc(o.empty || "No data for this yet.") + "</div>"; return; }
    var W = Math.max(host.clientWidth, 260), H = o.height;
    var min = Math.min(0, Math.min.apply(null, vals)), max = niceMax(Math.max.apply(null, vals));
    if (o.series.length === 1 && o.series[0].name === "Followers") { // totals: zoom to the range so growth is visible
      var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), span = Math.max(hi - lo, Math.max(hi * 0.02, 4));
      var step = niceMax(span / 3); min = Math.floor((lo - step * 0.25) / step) * step; max = min + step * Math.ceil((hi - min) / step + 0.001);
      if (min < 0) min = 0;
    } else if (min < 0) { min = -niceMax(-min); }
    var ticks = 4, labelW = Math.max(fmt(max).length, fmt(min).length) * 7 + 10;
    // Room on the right for the longest series name (about 7px per character at 12px bold).
    var nameW = Math.max.apply(null, o.series.map(function (s) { return s.name.length; }).concat([0])) * 7 + 14;
    var m = { t: 10, r: o.directLabels ? Math.max(84, nameW) : 12, b: 22, l: labelW };
    var iw = W - m.l - m.r, ih = H - m.t - m.b, n = o.weeks.length;
    function x(i) { return m.l + (n === 1 ? iw / 2 : i * iw / (n - 1)); }
    function y(v) { return m.t + ih - (v - min) / (max - min) * ih; }
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, height: H, role: "img", "aria-label": o.series.map(function (s) { return s.name; }).join(", ") + " by week" }, host);

    for (var t = 0; t <= ticks; t++) {
      var v = min + (max - min) * t / ticks, yy = y(v);
      el("line", { x1: m.l, x2: W - m.r, y1: yy, y2: yy, stroke: t === 0 || v === 0 ? "var(--axis)" : "var(--grid)", "stroke-width": 1 }, svg);
      if (!o.compact || t === 0 || t === ticks) el("text", { x: m.l - 6, y: yy + 4, "text-anchor": "end" }, svg).textContent = o.format(v);
    }
    var every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(iw / 64))));
    for (var i = 0; i < n; i++) {
      if ((n - 1 - i) % every !== 0) continue;
      el("text", { x: x(i), y: H - 4, "text-anchor": n === 1 ? "middle" : i === 0 ? "start" : i === n - 1 ? "end" : "middle" }, svg).textContent = shortDate(o.weeks[i]);
    }
    var labels = [];
    o.series.forEach(function (s) {
      var d = "", pen = false;
      s.values.forEach(function (v, i) {
        if (v == null) { pen = false; return; }
        d += (pen ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1);
        var lone = (i === 0 || s.values[i - 1] == null) && (i === n - 1 || s.values[i + 1] == null);
        if (lone) el("circle", { cx: x(i), cy: y(v), r: 3, fill: s.color }, svg);
        pen = true;
      });
      el("path", { d: d, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
      for (var j = n - 1; j >= 0; j--) if (s.values[j] != null) { labels.push({ s: s, y: y(s.values[j]), x: x(j) }); break; }
    });
    if (o.directLabels) {
      labels.sort(function (a, b) { return a.y - b.y; });
      for (var k = 1; k < labels.length; k++) if (labels[k].y - labels[k - 1].y < 14) labels[k].y = labels[k - 1].y + 14;
      labels.forEach(function (l) { el("text", { x: W - m.r + 8, y: l.y + 4, "class": "dl" }, svg).textContent = l.s.name; });
    }

    // Hover: crosshair + tooltip.
    var cross = el("line", { y1: m.t, y2: m.t + ih, stroke: "var(--axis)", "stroke-width": 1, visibility: "hidden" }, svg);
    var dots = o.series.map(function (s) { return el("circle", { r: 4.5, fill: s.color, stroke: "var(--surface)", "stroke-width": 2, visibility: "hidden" }, svg); });
    var hit = el("rect", { x: m.l - 10, y: 0, width: iw + 20, height: H, fill: "transparent" }, svg);
    var tip = $("tip");
    function hide() { cross.setAttribute("visibility", "hidden"); dots.forEach(function (d) { d.setAttribute("visibility", "hidden"); }); tip.style.display = "none"; }
    function move(ev) {
      var pt = ev.touches ? ev.touches[0] : ev;
      var rect = svg.getBoundingClientRect();
      var px = (pt.clientX - rect.left) * (W / rect.width);
      var i = n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round((px - m.l) / (iw / (n - 1)))));
      cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
      var rows = [];
      o.series.forEach(function (s, si) {
        var v = s.values[i];
        if (v == null) { dots[si].setAttribute("visibility", "hidden"); return; }
        dots[si].setAttribute("cx", x(i)); dots[si].setAttribute("cy", y(v)); dots[si].setAttribute("visibility", "visible");
        rows.push({ s: s, v: v });
      });
      rows.sort(function (a, b) { return b.v - a.v; });
      tip.innerHTML = '<div class="t">Week of ' + longDate(o.weeks[i]) + "</div>" + (rows.length ? rows.map(function (r) {
        return '<div class="r"><span><span class="sw" style="background:' + r.s.color + '"></span>' + r.s.name + "</span><b>" + o.format(r.v) + "</b></div>";
      }).join("") : '<div class="r">No data</div>');
      tip.style.display = "block";
      var tx = pt.clientX + 14, ty = pt.clientY + 14;
      if (tx + tip.offsetWidth > window.innerWidth - 8) tx = pt.clientX - tip.offsetWidth - 14;
      if (ty + tip.offsetHeight > window.innerHeight - 8) ty = pt.clientY - tip.offsetHeight - 14;
      tip.style.left = tx + "px"; tip.style.top = ty + "px";
    }
    hit.addEventListener("mousemove", move);
    hit.addEventListener("touchstart", move, { passive: true });
    hit.addEventListener("touchmove", move, { passive: true });
    hit.addEventListener("mouseleave", hide);
    hit.addEventListener("touchend", hide);
  }

  // ---------- controls ----------
  $("tip").style.position = "fixed";
  $("range").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    state.weeksBack = +b.dataset.w;
    [].forEach.call(this.children, function (c) { c.setAttribute("aria-pressed", c === b); });
    render();
  });
  $("metric").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    state.metric = b.dataset.m; renderMain(model.W, model.cur);
  });
  $("postFilter").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    state.postPlatform = b.dataset.p; renderPosts(model.cur);
  });
  $("posts").addEventListener("click", function (e) {
    var th = e.target.closest("th[data-sort]"); if (!th) return;
    state.postSort = th.dataset.sort; renderPosts(model.cur);
  });
  $("csvBtn").addEventListener("click", downloadCSV);
  var rt;
  window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(function () { if (model) render(); }, 150); });

  // Drag-and-drop preview: parse files in the browser without uploading anything.
  var drop = $("drop"), depth = 0;
  window.addEventListener("dragenter", function (e) { if (e.dataTransfer && [].indexOf.call(e.dataTransfer.types, "Files") >= 0) { depth++; drop.style.display = "grid"; } });
  window.addEventListener("dragleave", function () { if (--depth <= 0) { depth = 0; drop.style.display = "none"; } });
  window.addEventListener("dragover", function (e) { e.preventDefault(); });
  window.addEventListener("drop", function (e) {
    e.preventDefault(); depth = 0; drop.style.display = "none";
    var files = [].filter.call(e.dataTransfer.files, function (f) { return FILE_RE.test(f.name); });
    if (!files.length) return;
    var dlg = $("platDialog");
    $("platFiles").textContent = files.map(function (f) { return f.name; }).join(", ");
    $("platChoices").innerHTML = PLATFORMS.concat([{ id: "manual", name: "Manual weekly sheet" }]).map(function (p) { return '<button class="btn" data-p="' + p.id + '">' + p.name + "</button>"; }).join("") + '<button class="btn" data-p="">Cancel</button>';
    $("platChoices").onclick = function (ev) {
      var b = ev.target.closest("button"); if (!b) return;
      dlg.close();
      var platform = b.dataset.p; if (!platform) return;
      Promise.all(files.map(function (f) {
        return f.arrayBuffer().then(function (buf) {
          var res;
          try { res = parseFile(buf, f.name, platform); } catch (err) { res = {}; }
          var got = describeResult(res);
          state.files.push({ path: "(preview) " + f.name, platform: platform, ok: !!got, note: got || "no dates or recognisable columns found" });
          if (got) state.previewCount++;
        });
      })).then(render);
    };
    dlg.showModal();
  });

  load();
})();
