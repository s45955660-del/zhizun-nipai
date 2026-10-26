// ===== TCM APP =====
(function () {
  'use strict';

  const DATA = window.TCM_DATA;
  // 承淡安《伤寒论新注》放在独立数据文件里，启动时并入全书
  if (window.TCM_DATA_CHENGDAN && window.TCM_DATA_CHENGDAN.books) {
    window.TCM_DATA_CHENGDAN.books.forEach(b => {
      if (!DATA.books.some(x => x.id === b.id)) DATA.books.push(b);
    });
  }
  const IMG_BASE = 'images/';

  // 天纪卦名（正文用繁体）→ 卦象图解文件名（PDF 抽出的简体图）
  const GUA_CHAR = {
    '爲': '为', '為': '为', '師': '师', '風': '风', '澤': '泽', '謙': '谦', '隨': '随',
    '蠱': '蛊', '臨': '临', '觀': '观', '剝': '剥', '復': '复', '頤': '颐', '過': '过',
    '離': '离', '恆': '恒', '遯': '遁', '壯': '壮', '晉': '晋', '損': '损', '漸': '渐',
    '豐': '丰', '渙': '涣', '節': '节', '濟': '济', '賁': '贲', '兌': '兑', '歸': '归'
  };
  const GUA_FILE_ALIAS = {
    '火雷噬嗑': '火雷噬咳.png',
    '火水未济': '水火未济.png'
  };
  function guaJieSrc(title) {
    const name = String(title).replace(/[爲為師風澤謙隨蠱臨觀剝復頤過離恆遯壯晉損漸豐渙節濟賁兌歸]/g, c => GUA_CHAR[c] || c);
    return 'images/tianji_jie/' + (GUA_FILE_ALIAS[name] || (name + '.png'));
  }

  // ===== State =====
  const state = {
    currentTab: 'video',   // 当前板块: video / nizhu / tianji / yian
    currentPage: 'home',
    currentBookId: null,   // 当前选中的书
    currentChapterIdx: 0,  // 当前章索引
    currentJieIdx: 0,      // 当前小节索引
    currentPageIdx: 0,     // 当前内容页索引
    fontSize: 16,
    searchKeyword: '',
    globalSearchKeyword: '',
    contentKeyword: '',
    scrollToHl: false,
    highlightOn: true,   // 搜索关键词高亮开关（内容页底部五角星）
  };

  // ===== 四大板块定义 =====
  const TABS = [
    { key: 'video', label: '视频版教材', icon: 'book', books: [
        { id: 'shanghan', name: '伤寒论教材', display: '伤寒论' },
        { id: 'shennong', name: '神农本草经教材', display: '神农本草经' },
        { id: 'jinkui', name: '金匮要略教材', display: '金匮要略' },
        { id: 'huangdi', name: '黄帝内经教材', display: '黄帝内经上册' },
        { id: 'huangdi_xia', name: '黄帝内经下册教材', display: '黄帝内经下册' },
        { id: 'zhenjiu', name: '倪注针灸大成教材', display: '倪注针灸大成' },
    ]},
    { key: 'nizhu', label: '倪注版教材', icon: 'book', books: [
        { id: 'nizhu', name: '倪注伤寒论教材', display: '倪注伤寒论' },
        { id: 'chengdan_shanghan', name: '承注伤寒论', display: '承注伤寒论' },
        { id: 'nizhu_shennong', name: '倪注神农本草经教材', display: '倪注神农本草经' },
        { id: 'nizhu_jinkui', name: '倪海厦注解《金匮要略》教材', display: '倪海厦注解《金匮要略》' },
    ]},
    { key: 'tianji', label: '天纪', icon: 'taiji', books: [
        { id: 'nizhu_tianji', name: '倪海厦天纪·人间道教材', display: '倪海厦天纪·人间道' },
    ]},
    { key: 'yian', label: '医案', icon: 'pencil', books: [
        { id: 'yian_vol3', name: '人纪系列医案·第三册教材', display: '人纪系列医案·第三册' },
    ]},
  ];

  // 取当前板块
  function getCurrentTab() {
    return TABS.find(t => t.key === state.currentTab) || TABS[0];
  }

  // ===== 工具 =====
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function escapeReg(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // 判断是否为内联 HTML 块（方剂框 / 条文框），这些块需要原样输出不转义
  function isHtmlBlock(s) {
    const t = s.trim();
    return t.startsWith('<div class="formula-box">') || t.startsWith('<div class="verse-box">')
      || t.startsWith('<div class="cd-') || t.startsWith('<div class="tianji-');
  }

  // 把整页文本切分为「块」：HTML块（方剂/条文）整体保留，纯文本行按段落合并。
  // 倪注金匮等书的一页由若干块用 \n 拼接而成，必须先按块边界切开。
  function splitIntoBlocks(text) {
    const lines = text.split('\n');
    const blocks = [];   // {html:bool, lines:[]}
    let cur = null;
    const push = () => { if (cur && cur.lines.length) blocks.push(cur); cur = null; };
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('<div class="formula-box">') || line.startsWith('<div class="verse-box">')
          || line.startsWith('<div class="cd-') || line.startsWith('<div class="tianji-')) {
        push();
        blocks.push({ html: true, lines: [line] });
      } else {
        if (!cur || cur.html) { push(); cur = { html: false, lines: [] }; }
        cur.lines.push(line);
      }
    }
    push();
    return blocks;
  }

  // 智能合并短行为自然段落：PDF提取的文本常被分行截断，
  // 这里把不完整的短行拼接起来，只在句末标点处分段，提升可读性。
  function splitSmartParagraphs(text) {
    // 内联 HTML 块整体作为一个段落返回
    if (isHtmlBlock(text)) {
      return [text.trim()];
    }
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const paragraphs = [];
    let buf = '';
    for (const line of lines) {
      buf += line;
      // 句末标点结束一个句子/段落
      if (/[。！？；」』」」）」』：:]$/.test(line)) {
        paragraphs.push(buf);
        buf = '';
      }
      // 长行(>45字)即使无标点也视为一段结束，避免单段过长
      else if (buf.length > 45 && /[，、]/.test(line.slice(-2, -1))) {
        paragraphs.push(buf);
        buf = '';
      }
    }
    if (buf) paragraphs.push(buf);
    return paragraphs;
  }

  // 找书
  function getBook(id) {
    return DATA.books.find(b => b.id === id) || null;
  }
  function getBookByName(name) {
    return DATA.books.find(b => b.name === name) || null;
  }

  // ===== 路由 =====
  // 页面层级顺序：home -> jie -> content

  // 页面滚动位置缓存：回退时恢复浏览位置
  const pageScrollPos = {};
  function getScrollEl(page) {
    const target = $(`.page[data-page="${page}"]`);
    return target ? target.querySelector('.scrollable') : null;
  }
  function saveScrollPos(page) {
    // 只保存当前活跃（可见）页面的滚动位置：
    // display:none 的页面 scrollTop 已被浏览器重置为 0，保存会覆盖有效缓存
    const pg = page || state.currentPage;
    const target = $(`.page[data-page="${pg}"]`);
    if (!target || !target.classList.contains('active')) return;
    const el = target.querySelector('.scrollable');
    if (el) pageScrollPos[pg] = el.scrollTop;
  }

  // 切换页面并写入浏览器历史（前进：新内容置顶）
  function switchPage(page) {
    saveScrollPos(state.currentPage);
    state.currentPage = page;
    $$('.page').forEach(p => p.classList.remove('active'));
    const target = $(`.page[data-page="${page}"]`);
    if (target) target.classList.add('active');
    const scroll = getScrollEl(page);
    if (scroll) scroll.scrollTop = 0;
    delete pageScrollPos[page];
    try { history.pushState({ page }, ''); } catch (e) {}
  }

  // 纯显示切换（回退：恢复离开时的滚动位置）
  function showPage(page) {
    saveScrollPos(state.currentPage);
    state.currentPage = page;
    $$('.page').forEach(p => p.classList.remove('active'));
    const target = $(`.page[data-page="${page}"]`);
    if (target) target.classList.add('active');
    const scroll = getScrollEl(page);
    if (scroll) scroll.scrollTop = (pageScrollPos[page] !== undefined) ? pageScrollPos[page] : 0;
  }

  // 手机系统返回键 / 浏览器后退手势 / 返回按钮 共用回退逻辑
  // 注意：不要在 showPage 之前修改 state.currentPage，
  // 否则 showPage 内部会把已隐藏页面（scrollTop 已重置为 0）的位置存进缓存
  function goBack() {
    if (state.currentPage === 'search') {
      // 从搜索页回到首页（保留当前板块）
      showPage('home');
    } else if (state.currentPage === 'content') {
      // 回到来源页：板块内搜索结果 / 全局搜索结果 / 章节列表
      if (state.contentFrom === 'home-search') {
        // 板块内搜索：回 home 页，搜索结果面板与滚动位置均已保留
        showPage('home');
      } else if (state.contentFrom === 'global-search') {
        showPage('search');
      } else {
        showPage('jie');
      }
    } else if (state.currentPage === 'jie') {
      // 回到首页
      showPage('home');
    }
    // 在 home 时无需处理
  }

  // 手机系统返回键 / 浏览器后退手势处理
  window.addEventListener('popstate', function (e) {
    goBack();
  });

  // ===== 板块切换 =====
  function switchTab(key) {
    state.currentTab = key;
    // 高亮对应 tab
    $$('.tab').forEach(x => x.classList.toggle('tab-active', x.dataset.tab === key));

    if (key === 'search') {
      // 进入全局搜索页
      showPage('search');
      setTimeout(() => $('#global-search').focus(), 50);
      return;
    }

    // 无论当前在哪个页面，切换板块都回到板块列表页（home）
    $('#home-search').value = '';
    $('#home-search').placeholder = key === 'tianji' ? '搜索卦名，如乾为天、水风井' : '查询当前板块中的内容';
    state.searchKeyword = '';
    updateClearBtn();
    $('#search-results').style.display = 'none';
    $('#book-sections-container').style.display = '';
    showPage('home');
    renderHome();
  }

  // ===== 板块列表页渲染 =====
  function normName(s) {
    return String(s || '').toLowerCase().replace(/[爲為]/g, '为').replace(/\s+/g, '');
  }

  function markedTitle(title, keyword) {
    const shown = shortChapterTitle(title);
    const kw = String(keyword || '').trim();
    const i = shown.toLowerCase().indexOf(kw.toLowerCase());
    if (!kw || i < 0) return escapeHtml(shown);
    return escapeHtml(shown.slice(0, i)) + '<mark>' + escapeHtml(shown.slice(i, i + kw.length)) + '</mark>' + escapeHtml(shown.slice(i + kw.length));
  }

  function titleHitsFor(keyword) {
    const nk = normName(keyword);
    if (!nk) return [];
    const hits = [];
    getCurrentTab().books.forEach(meta => {
      const book = getBook(meta.id);
      if (!book) return;
      book.chapters.forEach((ch, idx) => {
        if (normName(ch.title).includes(nk)) hits.push({ book, ch, idx });
      });
    });
    return hits;
  }

  function renderHome(keyword) {
    const tab = getCurrentTab();
    $('#board-title').textContent = tab.label;
    const container = $('#book-sections-container');
    container.innerHTML = '';
    const kw = String(keyword || '').trim();
    const nk = normName(kw);

    // 医案空板块
    if (tab.empty) {
      const emptyBox = document.createElement('div');
      emptyBox.className = 'empty-board';
      emptyBox.innerHTML = `
        <div class="empty-board-icon">✏️</div>
        <div class="empty-board-title">暂无医案</div>
        <div class="empty-board-desc">医案板块即将上线，敬请期待。</div>
      `;
      container.appendChild(emptyBox);
      return;
    }

    tab.books.forEach(book => {
      const realBook = getBook(book.id);
      const hasData = !!realBook;
      const section = document.createElement('div');
      section.className = 'book-section';

      const showAll = tab.key === 'tianji' || !!nk;
      const header = document.createElement('div');
      header.className = 'section-header';
      header.innerHTML = `
        <span class="section-bar"></span>
        <span class="section-title">${book.name}</span>
        ${hasData && !showAll && realBook.chapters.length > 9 ? '<a class="section-link">查看列表 ›</a>' : ''}
      `;
      section.appendChild(header);

      if (hasData) {
        const grid = document.createElement('div');
        grid.className = 'chapter-grid';
        const flags = realBook.chapters.map(ch => nk && normName(ch.title).includes(nk));
        if (nk && !flags.some(Boolean)) return;
        function makeBtn(ch, idx, hit, dim) {
          const btn = document.createElement('div');
          btn.className = 'chapter-btn' + (hit ? ' chapter-btn-hit' : '') + (dim ? ' chapter-btn-dim' : '');
          btn.innerHTML = hit ? markedTitle(ch.title, kw) : escapeHtml(shortChapterTitle(ch.title));
          btn.title = ch.title;
          btn.addEventListener('click', () => {
            state.currentBookId = realBook.id;
            state.currentChapterIdx = idx;
            state.currentJieIdx = 0;
            openJieList();
          });
          return btn;
        }
        const showCount = showAll ? realBook.chapters.length : Math.min(9, realBook.chapters.length);
        for (let i = 0; i < showCount; i++) {
          grid.appendChild(makeBtn(realBook.chapters[i], i, flags[i], nk && !flags[i]));
        }
        if (!showAll && realBook.chapters.length > showCount) {
          const more = document.createElement('div');
          more.className = 'chapter-btn chapter-btn-more';
          more.textContent = `查看全部 ${realBook.chapters.length} 章 ›`;
          more.addEventListener('click', () => toggleExpand(section, realBook, grid, makeBtn, more));
          grid.appendChild(more);
        }
        section.appendChild(grid);

        const link = header.querySelector('.section-link');
        if (link) {
          link.addEventListener('click', () => toggleExpand(section, realBook, grid, makeBtn, grid.querySelector('.chapter-btn-more')));
        }
      } else {
        // 无数据教材
        const grid = document.createElement('div');
        grid.className = 'chapter-grid';
        for (let i = 0; i < 6; i++) {
          const btn = document.createElement('div');
          btn.className = 'chapter-btn disabled';
          btn.textContent = '待更新';
          grid.appendChild(btn);
        }
        section.appendChild(grid);
      }
      container.appendChild(section);
    });
  }

  function shortChapterTitle(title) {
    // 去掉 "第X章 " 或 "壹、" 之类前缀，但保留主体
    let t = title;
    t = t.replace(/^第[一二三四五六七八九十百千]+章/, '');
    t = t.replace(/^[壹贰叁肆伍]、/, '');
    return t || title;
  }

  // 主页：就地展开/收起某本书的全部章节，方便挑选
  function toggleExpand(section, realBook, baseGrid, makeBtn, moreBtn) {
    const existing = section.querySelector('.chapter-grid-expanded');
    // 若已展开则收起
    if (existing) {
      existing.remove();
      baseGrid.style.display = '';
      if (moreBtn) {
        moreBtn.textContent = `查看全部 ${realBook.chapters.length} 章 ›`;
        moreBtn.style.display = '';
      }
      const link = section.querySelector('.section-link');
      if (link) link.textContent = '查看列表 ›';
      return;
    }
    // 否则展开：隐藏前9个，显示全部章节
    baseGrid.style.display = 'none';
    if (moreBtn) moreBtn.style.display = 'none';
    const link = section.querySelector('.section-link');
    if (link) link.textContent = '收起列表 ‹';

    const expanded = document.createElement('div');
    expanded.className = 'chapter-grid chapter-grid-expanded';
    realBook.chapters.forEach((ch, idx) => {
      expanded.appendChild(makeBtn(ch, idx));
    });
    // 底部"收起"按钮
    const close = document.createElement('div');
    close.className = 'chapter-btn chapter-btn-more';
    close.textContent = '收起 ‹';
    close.addEventListener('click', () => {
      expanded.remove();
      baseGrid.style.display = '';
      if (moreBtn) {
        moreBtn.style.display = '';
        moreBtn.textContent = `查看全部 ${realBook.chapters.length} 章 ›`;
      }
      if (link) link.textContent = '查看列表 ›';
    });
    expanded.appendChild(close);
    section.appendChild(expanded);
  }

  // ===== 章节列表页 =====
  function openJieList() {
    switchPage('jie', { push: true });
    const book = getBook(state.currentBookId);
    if (!book) return;
    const chapter = book.chapters[state.currentChapterIdx];

    $('#jie-title').textContent = book.name + '文字稿';

    // 顶 tabs：横向滚动显示该书所有章节，点任意一个直接跳转
    const tabs = $('#top-tabs');
    tabs.innerHTML = '';
    const total = book.chapters.length;
    for (let i = 0; i < total; i++) {
      const t = document.createElement('div');
      t.className = 'top-tab' + (i === state.currentChapterIdx ? ' active' : '');
      t.innerHTML = `<span style="white-space:nowrap">${escapeHtml(shortChapterTitle(book.chapters[i].title))}</span>`;
      t.addEventListener('click', () => {
        if (i === state.currentChapterIdx) return;
        state.currentChapterIdx = i;
        state.currentJieIdx = 0;
        openJieList();
      });
      tabs.appendChild(t);
    }
    setTimeout(() => {
      const activeTab = tabs.querySelector('.top-tab.active');
      if (activeTab) activeTab.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }, 30);

    // 列表
    const list = $('#jie-list');
    list.innerHTML = '';
    chapter.children.forEach((jie, j) => {
      const card = document.createElement('div');
      card.className = 'jie-card';
      const jieTitle = jie.jie_title === chapter.title ? chapter.title : jie.jie_title;
      card.innerHTML = `
        <div class="jie-card-head">
          <span class="jie-card-pian" title="${escapeHtml(chapter.title)}">${escapeHtml(shortChapterTitle(chapter.title))}</span>
        </div>
        <div class="jie-card-title">${escapeHtml(jieTitle)}</div>
        <div class="jie-card-snippet">${escapeHtml(jie.snippet || '　')}</div>
        <div class="jie-card-meta">
          <span class="jie-card-tag">${escapeHtml(book.name)}文字稿</span>
          <span class="jie-card-pos">${jie.page_count} 页</span>
        </div>
      `;
      card.addEventListener('click', () => {
        state.currentJieIdx = j;
        state.currentPageIdx = 0;
        state.contentFrom = 'jie';
        state.contentKeyword = '';
        openContent();
      });
      list.appendChild(card);
    });
  }

  // ===== 内容详情页 =====
  function openContent() {
    renderPageContent();
    updateNavButtons();
    applyHighlight();
    switchPage('content', { push: true });
  }

  function renderPageContent() {
    const book = getBook(state.currentBookId);
    if (!book) return;
    const chapter = book.chapters[state.currentChapterIdx];
    const jie = chapter.children[state.currentJieIdx];
    const pageText = jie.pages[state.currentPageIdx] || '';
    const article = $('#article');

    let titleText = jie.jie_title === chapter.title ? chapter.title : jie.jie_title;
    let html = `<h1 class="article-title">${escapeHtml(titleText)}</h1>`;

    // 面包屑
    if (jie.jie_title !== chapter.title) {
      html = `
        <h1 class="article-title">${escapeHtml(shortChapterTitle(chapter.title))}</h1>
        <div class="article-breadcrumb">
          <span class="crumb">${escapeHtml(shortChapterTitle(chapter.title))}</span>
          <span class="crumb">${escapeHtml(jie.jie_title)}</span>
        </div>
      `;
    }

    // 图片（第0页）。天纪先放卦象图解，再放原书卦象。文件已被删掉时不留破图。
    if (state.currentPageIdx === 0) {
      const imgs = [];
      if (book.id === 'nizhu_tianji' && jie.jie_title && jie.jie_title !== '前言' && jie.images && jie.images.length) {
        imgs.push(guaJieSrc(jie.jie_title));
      }
      (jie.images || []).forEach(img => {
        imgs.push(typeof img === 'string' ? img : (IMG_BASE + img.name));
      });
      imgs.forEach(src => {
        html += `<img class="article-image" src="${escapeHtml(src)}" alt="${escapeHtml(jie.jie_title || '')}">`;
      });
    }

    // 段落（若来自搜索，关键词标黄）
    const kw = state.contentKeyword || '';
    const isYian = /^【[^】]{1,8}】/.test(pageText.trim().split('\n')[0] || '');
    const isTianji = book.id === 'nizhu_tianji';
    const guaAt = isTianji ? pageText.search(/卦[圖图]象解/) : -1;
    if (guaAt >= 0) {
      html += '<div class="article-content">';
      html += renderArticleBlocks(pageText.slice(0, guaAt), kw, false, true);
      html += '</div>';
      const tail = pageText.slice(guaAt);
      const titleMatch = tail.match(/^(卦[圖图]象解)/);
      const guaTitle = titleMatch ? titleMatch[1] : '卦圖象解';
      const guaRest = tail.slice(guaTitle.length).replace(/^\s*/, '');
      html += '<div class="article-content gua-note">';
      html += `<p class="gua-note-title">${escapeHtml(guaTitle)}</p>`;
      html += renderArticleBlocks(guaRest, kw, false, false);
      html += '</div>';
    } else {
      html += '<div class="article-content' + (isYian ? ' yian-content' : '') + '">';
      html += renderArticleBlocks(pageText, kw, isYian, isTianji && !isYian);
      html += '</div>';
    }

    // 页码
    if (jie.pages.length > 1) {
      html += `<div class="article-page-indicator">— 第 ${state.currentPageIdx + 1} / ${jie.pages.length} 页 —</div>`;
    }
    article.innerHTML = html;
    article.style.fontSize = state.fontSize + 'px';
    // 图片包里被删掉的文件不要留出破损碎片
    article.querySelectorAll('img.article-image').forEach(img => {
      img.addEventListener('error', () => img.remove());
    });

    // 仅从搜索进入时滚动到第一个标黄处（翻页时不打断阅读）
    if (kw && state.scrollToHl) {
      state.scrollToHl = false;
      const first = article.querySelector('.search-hl');
      if (first) setTimeout(() => first.scrollIntoView({ block: 'center', behavior: 'smooth' }), 120);
    } else {
      $('#content-scroll').scrollTop = 0;
    }
  }

  function markYao(html) {
    return html.replace(/上九|上六|初九|初六|九[一二三四五]|六[一二三四五六]/g, m => `<span class="yao-name">${m}</span>`);
  }

  function renderArticleBlocks(pageText, kw, isYian, markYaoOn) {
    let html = '';
    if (isYian) {
      const lines = pageText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      lines.forEach(line => {
        let inner = escapeHtml(line).replace(/【([^】]{1,8})】/g, '<span class="yian-label">$1</span>');
        if (kw) inner = highlightText(inner, kw);
        html += `<p class="yian-line">${inner}</p>`;
      });
      return html;
    }
    const blocks = splitIntoBlocks(pageText);
    blocks.forEach(b => {
      if (b.html) {
        const block = b.lines.join('');
        html += kw ? addHlClassToFormula(block, kw) : block;
      } else {
        const paragraphs = splitSmartParagraphs(b.lines.join('\n'));
        paragraphs.forEach(p => {
          let inner = escapeHtml(p).replace(/\n/g, '<br>');
          if (markYaoOn) inner = markYao(inner);
          if (kw) inner = highlightText(inner, kw);
          html += `<p>${inner}</p>`;
        });
      }
    });
    return html;
  }

  // 对已转义的HTML做关键词标黄（不破坏标签）
  function highlightText(html, keyword) {
    if (!keyword) return html;
    const parts = html.split(/(<[^>]+>)/g);  // 保留标签
    const re = new RegExp(escapeReg(keyword), 'gi');
    return parts.map(seg => {
      if (seg.startsWith('<')) return seg;
      return seg.replace(re, m => `<mark class="search-hl">${m}</mark>`);
    }).join('');
  }

  function escapeReg(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // 方剂框内也标黄（仅处理文本内容）
  function addHlClassToFormula(html, keyword) {
    return html.replace(/>([^<]+)</g, (m, text) => {
      const re = new RegExp(escapeReg(keyword), 'gi');
      return '>' + text.replace(re, x => `<mark class="search-hl">${x}</mark>`) + '<';
    });
  }

  function updateNavButtons() {
    const book = getBook(state.currentBookId);
    if (!book) return;
    const chapter = book.chapters[state.currentChapterIdx];
    const jie = chapter.children[state.currentJieIdx];
    const prev = $('#btn-prev');
    const next = $('#btn-next');

    const hasPrev = state.currentPageIdx > 0 || state.currentJieIdx > 0 || state.currentChapterIdx > 0;
    const hasNext = state.currentPageIdx < jie.pages.length - 1 || state.currentJieIdx < chapter.children.length - 1 || state.currentChapterIdx < book.chapters.length - 1;
    prev.classList.toggle('disabled', !hasPrev);
    next.classList.toggle('disabled', !hasNext);
  }

  // 高亮开关状态同步：五角星实心/空心 + 内容页标黄显隐
  function applyHighlight() {
    const btn = $('#btn-hl');
    if (btn) {
      const path = btn.querySelector('svg path');
      if (path) path.setAttribute('fill', state.highlightOn ? 'currentColor' : 'none');
      btn.classList.toggle('hl-active', state.highlightOn);
    }
    const article = $('#article');
    if (article) article.classList.toggle('hl-hidden', !state.highlightOn);
  }

  function goPrev() {
    const book = getBook(state.currentBookId);
    if (!book) return;
    const chapter = book.chapters[state.currentChapterIdx];
    const jie = chapter.children[state.currentJieIdx];
    if (state.currentPageIdx > 0) {
      state.currentPageIdx--;
    } else if (state.currentJieIdx > 0) {
      state.currentJieIdx--;
      state.currentPageIdx = book.chapters[state.currentChapterIdx].children[state.currentJieIdx].pages.length - 1;
    } else if (state.currentChapterIdx > 0) {
      state.currentChapterIdx--;
      const nc = book.chapters[state.currentChapterIdx];
      state.currentJieIdx = nc.children.length - 1;
      state.currentPageIdx = nc.children[state.currentJieIdx].pages.length - 1;
    } else return;
    afterNavigate();
  }

  function goNext() {
    const book = getBook(state.currentBookId);
    if (!book) return;
    const chapter = book.chapters[state.currentChapterIdx];
    const jie = chapter.children[state.currentJieIdx];
    if (state.currentPageIdx < jie.pages.length - 1) {
      state.currentPageIdx++;
    } else if (state.currentJieIdx < chapter.children.length - 1) {
      state.currentJieIdx++;
      state.currentPageIdx = 0;
    } else if (state.currentChapterIdx < book.chapters.length - 1) {
      state.currentChapterIdx++;
      state.currentJieIdx = 0;
      state.currentPageIdx = 0;
    } else return;
    afterNavigate();
  }

  function afterNavigate() {
    renderPageContent();
    updateNavButtons();
    applyHighlight();
    const scroll = $('.page-content .scrollable');
    if (scroll) scroll.scrollTop = 0;
  }

  // ===== 搜索 =====
  let searchDebounce;
  function onSearchInput() {
    const val = $('#home-search').value.trim();
    state.searchKeyword = val;
    updateClearBtn();
    clearTimeout(searchDebounce);
    if (!val) {
      $('#search-results').style.display = 'none';
      $('#book-sections-container').style.display = '';
      renderHome();
      return;
    }
    searchDebounce = setTimeout(() => {
      if (titleHitsFor(val).length) {
        $('#search-results').style.display = 'none';
        $('#book-sections-container').style.display = '';
        renderHome(val);
        const first = document.querySelector('.chapter-btn-hit');
        if (first) first.scrollIntoView({ block: 'center' });
      } else {
        runSearch(val);
      }
    }, 180);
  }

  // 全局搜索输入
  let globalSearchDebounce;
  function onGlobalSearchInput() {
    const val = $('#global-search').value.trim();
    state.globalSearchKeyword = val;
    updateGlobalClearBtn();
    clearTimeout(globalSearchDebounce);
    if (!val) {
      $('#global-search-results').style.display = 'none';
      $('#global-search-results-list').innerHTML = '';
      $('#global-search-hint').style.display = '';
      return;
    }
    globalSearchDebounce = setTimeout(() => runGlobalSearch(val), 180);
  }

  function updateGlobalClearBtn() {
    const btn = $('#global-search-clear');
    btn.style.display = state.globalSearchKeyword ? 'flex' : 'none';
  }

  function updateClearBtn() {
    const btn = $('#search-clear');
    btn.style.display = state.searchKeyword ? 'flex' : 'none';
  }

  function runSearch(keyword) {
    const kw = keyword.toLowerCase();
    const tab = getCurrentTab();
    // 收集所有命中，按书分组（只搜当前板块的书）
    const byBook = {};
    tab.books.forEach(bookMeta => {
      const book = getBook(bookMeta.id);
      if (!book) return;
      collectBookHits(book, kw, byBook);
    });
    renderSearchResults(byBook, keyword, kw);
  }

  // 全局搜索：搜索全部教材
  function runGlobalSearch(keyword) {
    const kw = keyword.toLowerCase();
    const byBook = {};
    DATA.books.forEach(book => {
      collectBookHits(book, kw, byBook);
    });
    renderGlobalSearchResults(byBook, keyword, kw);
  }

  // 收集单本书的命中
  function collectBookHits(book, kw, byBook) {
    const bookHits = [];
    book.chapters.forEach((chapter, ci) => {
      chapter.children.forEach((jie, ji) => {
        const fullText = jie.pages.join('\n\n');
        const lower = fullText.toLowerCase();
        let idx = lower.indexOf(kw);
        if (idx < 0) return;
        // 以剥离标签后的纯文本为准计算片段范围，避免摘要里露出 <div> 等标签
        const plainText = fullText.replace(/<[^>]+>/g, '');
        const plainLower = plainText.toLowerCase();
        const pIdx = plainLower.indexOf(kw);
        const base = pIdx >= 0 ? pIdx : idx;
        const start = Math.max(0, base - 40);
        const end = Math.min(plainText.length, base + kw.length + 80);
        let snippet = plainText.substring(start, end).replace(/\s+/g, ' ').trim();
        if (start > 0) snippet = '…' + snippet;
        if (end < plainText.length) snippet = snippet + '…';
        bookHits.push({ chapter, ci, jie, ji, snippet, idx });
      });
    });
    if (bookHits.length > 0) {
      byBook[book.id] = { book, hits: bookHits };
    }
  }

  function renderSearchResults(byBook, keyword, kw) {
    renderHitGroups(byBook, keyword, kw, $('#search-results-list'), $('#search-count'), 'home-search');
    $('#search-results').style.display = '';
    $('#book-sections-container').style.display = 'none';
  }

  // 全局搜索结果渲染到搜索页
  function renderGlobalSearchResults(byBook, keyword, kw) {
    renderHitGroups(byBook, keyword, kw, $('#global-search-results-list'), $('#global-search-count'), 'global-search');
    $('#global-search-results').style.display = '';
    $('#global-search-hint').style.display = 'none';
  }

  function renderHitGroups(byBook, keyword, kw, list, countEl, from) {
    list.innerHTML = '';
    const ids = Object.keys(byBook);
    if (ids.length === 0) {
      list.innerHTML = `<div style="padding:60px 16px;text-align:center;color:#9ca3af;">没有找到相关内容</div>`;
    } else {
      ids.forEach((bookId, bi) => {
        const { book, hits } = byBook[bookId];
        // 计算每本书的展开状态（默认展开第一本）
        const expanded = bi === 0;
        const group = document.createElement('div');
        group.className = 'search-group';

        // 分组头：书名 + 命中数，点击展开/折叠
        const head = document.createElement('div');
        head.className = 'search-group-head';
        head.innerHTML = `
          <div class="search-group-left">
            <span class="search-group-arrow">${expanded ? '▾' : '▸'}</span>
            <span class="search-group-name">${escapeHtml(book.name)}</span>
          </div>
          <span class="search-group-count">${hits.length} 处</span>
        `;

        // 分组体：该书下的命中条目
        const body = document.createElement('div');
        body.className = 'search-group-body' + (expanded ? ' open' : '');
        hits.forEach(r => {
          // 计算所在页
          let pos = 0;
          let pageIdx = 0;
          for (let p = 0; p < r.jie.pages.length; p++) {
            if (r.idx < pos + r.jie.pages[p].length + 2) {
              pageIdx = p;
              break;
            }
            pos += r.jie.pages[p].length + 2;
          }
          const item = document.createElement('div');
          item.className = 'search-item';
          item.innerHTML = `
            <div class="search-item-title">${escapeHtml(shortChapterTitle(r.chapter.title))} · ${escapeHtml(r.jie.jie_title)}</div>
            <div class="search-item-bread">${escapeHtml(book.name)} · ${escapeHtml(r.chapter.title)} · 第${pageIdx+1}页</div>
            <div class="search-item-snippet">${highlight(r.snippet, keyword)}</div>
          `;
          item.addEventListener('click', () => {
            state.currentBookId = book.id;
            state.currentChapterIdx = r.ci;
            state.currentJieIdx = r.ji;
            state.currentPageIdx = pageIdx;
            state.contentFrom = from;
            state.contentKeyword = keyword;
            state.scrollToHl = true;
            openContent();
          });
          body.appendChild(item);
        });

        // 头部点击切换展开/折叠
        head.addEventListener('click', () => {
          const isOpen = body.classList.contains('open');
          body.classList.toggle('open', !isOpen);
          head.querySelector('.search-group-arrow').textContent = isOpen ? '▸' : '▾';
        });

        group.appendChild(head);
        group.appendChild(body);
        list.appendChild(group);
      });
    }

    countEl.textContent = `共 ${ids.length} 本书、${Object.keys(byBook).reduce((s,k)=>s+byBook[k].hits.length,0)} 处命中`;
  }

  function highlight(text, kw) {
    const safe = escapeHtml(text);
    const re = new RegExp(`(${escapeReg(kw)})`, 'gi');
    return safe.replace(re, '<mark>$1</mark>');
  }

  // ===== Toast =====
  function showToast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,.78);color:#fff;padding:8px 18px;border-radius:6px;font-size:14px;z-index:9999;';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 1500);
  }

  // ===== 事件 =====
  function bind() {
    $$('[data-back]').forEach(b => b.addEventListener('click', e => {
      e.preventDefault();
      goBack();
    }));

    $('#home-search').addEventListener('input', onSearchInput);
    $('#search-clear').addEventListener('click', () => {
      $('#home-search').value = '';
      state.searchKeyword = '';
      updateClearBtn();
      onSearchInput();
      $('#home-search').focus();
    });

    // 全局搜索页
    $('#global-search').addEventListener('input', onGlobalSearchInput);
    $('#global-search-clear').addEventListener('click', () => {
      $('#global-search').value = '';
      state.globalSearchKeyword = '';
      updateGlobalClearBtn();
      onGlobalSearchInput();
      $('#global-search').focus();
    });

    $('#btn-prev').addEventListener('click', goPrev);
    $('#btn-next').addEventListener('click', goNext);
    // 高亮开关：五角星实心=显示关键词标黄，空心=关闭
    $('#btn-hl').addEventListener('click', () => {
      state.highlightOn = !state.highlightOn;
      applyHighlight();
    });

    $$('.tab').forEach(t => t.addEventListener('click', e => {
      e.preventDefault();
      switchTab(t.dataset.tab);
    }));
  }

  // ===== 启动 =====
  function fitScreen() {
    const vv = window.visualViewport;
    const h = Math.max(
      window.innerHeight || 0,
      vv ? vv.height + (vv.offsetTop || 0) : 0
    );
    document.documentElement.style.setProperty('--app-h', Math.round(h) + 'px');
  }
  fitScreen();
  window.addEventListener('resize', fitScreen);
  window.addEventListener('orientationchange', fitScreen);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitScreen);
  }

  document.addEventListener('DOMContentLoaded', () => {
    // 建立历史锚点
    try { history.replaceState({ page: 'home' }, ''); } catch (e) {}

    bind();

    // 测试用：URL参数
    const p = new URLSearchParams(location.search).get('p');
    const urlTab = new URLSearchParams(location.search).get('tab');
    const urlBook = new URLSearchParams(location.search).get('book');

    // 指定初始板块
    if (urlTab === 'chengdan') {
      state.currentTab = 'nizhu';
    } else if (urlTab && TABS.some(t => t.key === urlTab)) {
      state.currentTab = urlTab;
    }
    if (state.currentTab === 'tianji') {
      $('#home-search').placeholder = '搜索卦名，如乾为天、水风井';
    }

    renderHome();

    if (p === 'jie' || p === 'content' || p === 'test') {
      // 指定书
      if (urlBook) {
        const b = getBookByName(decodeURIComponent(urlBook)) || getBook(urlBook);
        if (b) {
          state.currentBookId = b.id;
          const ci = parseInt(new URLSearchParams(location.search).get('ch') || '0');
          const ji = parseInt(new URLSearchParams(location.search).get('jie') || '0');
          state.currentChapterIdx = ci;
          state.currentJieIdx = ji;
          state.currentPageIdx = 0;
        }
      }
      if (p === 'jie') setTimeout(() => openJieList(), 50);
      else if (p === 'content' || p === 'test') setTimeout(() => openContent(), 50);
    } else if (p === 'search') {
      const q = new URLSearchParams(location.search).get('q') || '阴阳';
      setTimeout(() => {
        $('#home-search').value = q;
        state.searchKeyword = q;
        updateClearBtn();
        runSearch(q);
      }, 80);
    }
  });

})();
