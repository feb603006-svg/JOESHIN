/* ============================================================
 * 更新檔 001：首頁改成三個獨立區塊（由上到下）
 *   1. 重點整理：高中 / 高職
 *   2. 考試區　：高中 / 高職（進去後一路選到單元，會直接開「題目（考卷）」頁）
 *   3. 題庫　　：永遠在最下面，直接列出題庫單元，點單元就進去
 * ============================================================ */
(function () {
  "use strict";
  if (typeof window.registerUpdate === "function") window.registerUpdate("首頁分成三個獨立區塊：重點整理、考試區、題庫（題庫永遠在最下面）");

  var catGrid = document.getElementById("categoryGrid");
  var bankGrid = document.getElementById("bankGrid");
  if (!catGrid || !bankGrid || document.getElementById("examGrid")) return;   // 找不到版面，或已經套用過

  // ── 1) 樣式 ──
  var st = document.createElement("style");
  st.textContent =
    "#examGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); max-width: 900px; margin-left: auto; margin-right: auto; }" +
    "#examGrid .card { padding: 36px 20px; }" +
    "#examGrid .card h3 { font-size: 24px; }" +
    "h2.home-section-title ~ h2.home-section-title { margin-top: 48px; }";
  document.head.appendChild(st);

  // ── 2) 版面：重點整理 → 考試區 → 題庫（題庫的格子原本就在最後面） ──
  function heading(text) {
    var h = document.createElement("h2");
    h.className = "home-section-title";
    h.textContent = text;
    return h;
  }
  var examGrid = document.createElement("div");
  examGrid.id = "examGrid";
  examGrid.className = "grid-container";
  var parent = bankGrid.parentNode;
  parent.insertBefore(heading("考試區"), bankGrid);
  parent.insertBefore(examGrid, bankGrid);
  parent.insertBefore(heading("題庫"), bankGrid);

  // ── 3) 「考試區」：同樣的層級，但選到單元時直接開題目頁 ──
  var examNavMode = false;
  window.enterCategoryNotes = function (cat) { examNavMode = false; window.enterCategory(cat); };
  window.enterCategoryExam = function (cat) { window.enterCategory(cat); examNavMode = true; };

  var origShowLevel1 = window.showLevel1;
  window.showLevel1 = function () { examNavMode = false; return origShowLevel1.apply(this, arguments); };

  var origEnterTopic = window.enterTopic;
  window.enterTopic = function () {
    var r = origEnterTopic.apply(this, arguments);
    if (examNavMode) window.switchSection("quiz");
    return r;
  };

  var origSearchGo = window.searchGo;   // 用搜尋進入時，一律回到「重點整理」的看法
  window.searchGo = function () { examNavMode = false; return origSearchGo.apply(this, arguments); };

  function examCountForCategory(cat) {
    var n = 0, q = rawDb.quizzes || {}, c = rawDb.categories[cat] || {};
    Object.keys(c).forEach(function (g) {
      Object.keys(c[g] || {}).forEach(function (sub) {
        Object.keys(c[g][sub] || {}).forEach(function (t) { n += ((q[sub] || {})[t] || []).length; });
      });
    });
    return n;
  }

  function renderExamGrid() {
    ensureDb();
    var order = ["國小", "國中", "高中", "高職"];
    var cats = Object.keys(rawDb.categories || {}).filter(function (c) { return HIDDEN_CATEGORIES.indexOf(c) < 0; }).sort(function (a, b) {
      var ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    if (!cats.length) {
      examGrid.innerHTML = '<div style="grid-column:1/-1; text-align:center; color:#94a3b8; padding:24px;">目前沒有任何學制</div>';
      return;
    }
    examGrid.innerHTML = cats.map(function (cat) {
      return '<div class="card"><div class="card-body" onclick="window.enterCategoryExam(\'' + qa(cat) + '\')">' +
        "<h3>📝 " + esc(cat) + "</h3><p>" + examCountForCategory(cat) + " 份考卷</p></div></div>";
    }).join("") +
      '<div style="grid-column:1/-1; text-align:center;"><button class="btn btn-secondary" type="button" onclick="window.openExamZone()">📋 查看全部考卷（' + examZoneCount() + " 份）</button></div>";
  }

  // ── 4) 「題庫」：直接把單元列在首頁，點單元就進去（看題數 / 隨機抽取 / 查看題庫） ──
  window.bankOpenUnit = function (id) {
    ensureDb();
    bankState = { view: "unit", unitId: id };
    renderBank();
    window.openModal("bankModal");
  };

  window.renderBankCard = function () {
    ensureDb();
    var units = rawDb.bank.units;
    var html = "";
    if (isAdmin) {
      html += '<div style="grid-column:1/-1; text-align:right;"><button class="btn" type="button" style="background:#10b981;" onclick="window.bankAddUnit()">➕ 新增單元</button></div>';
    }
    if (!units.length) {
      html += '<div style="grid-column:1/-1; text-align:center; color:#94a3b8; padding:24px;">目前還沒有題庫單元' + (isAdmin ? "，請按上方「➕ 新增單元」" : "") + "</div>";
    } else {
      html += units.map(function (u) {
        return '<div class="card"><div class="card-body" onclick="window.bankOpenUnit(\'' + qa(u.id) + '\')">' +
          "<h3>📁 " + esc(u.name) + "</h3><p>" + u.questions.length + " 題</p></div></div>";
      }).join("");
    }
    bankGrid.innerHTML = html;
  };

  // ── 5) 接到首頁的重新繪製流程 ──
  var origRenderCategories = window.renderCategories;
  window.renderCategories = function () {
    var r = origRenderCategories.apply(this, arguments);
    Array.prototype.forEach.call(document.querySelectorAll("#categoryGrid .card-body"), function (el) {
      var o = el.getAttribute("onclick") || "";
      if (o.indexOf("window.enterCategory(") === 0) el.setAttribute("onclick", o.replace("window.enterCategory(", "window.enterCategoryNotes("));
    });
    renderExamGrid();
    return r;
  };

  // 更新檔是在首頁畫完之後才載入的，所以現在要再畫一次
  var home = document.getElementById("level0View");
  if (home && home.style.display !== "none") window.renderCategories();
})();
