// 資料來源
const DATA_URL = "https://raw.githubusercontent.com/g0v/moedict-data-twblg/refs/heads/master/dict-twblg.json";

// 台語常見聲母表，比對拼音開頭，剝離前方聲母以取出韻腳， 順序由長至短排列
const initials = ["tsh", "ts", "ph", "th", "kh", "ng", "m", "p", "t", "k", "g", "b", "l", "h", "s", "j", "n"];

// Unicode 組合音標（NFD 格式）與標準台語調號的對應表
const toneMap = { '\u0301': 2, '\u0300': 3, '\u0302': 5, '\u0306': 6, '\u0304': 7, '\u030d': 8 };

// 介面標籤（韻尾分類）的中文對照表
const typeLabelMap = {
  "pure": "純母音",        // 如：a, i, u
  "nasalVowel": "鼻化母音",  // 如：ann, inn
  "nasalCons": "鼻音韻尾",   // 如：am, an, ang
  "checked": "入聲韻",      // 以 p, t, k, h 結尾
  "other": "其他"          // 無法歸入上述四類的特殊情況
};

// 全域狀態記憶體
let rhymeDictionary = {};       // 巢狀索引結構：{ 核心主音: { 具體韻腳: 韻尾分類 } }，加速 UI 生成
let currentMainVowel = "all";   // 當前選取主音 (如 'a', 'e', 'none', 'all')
let currentRhyme = "all";       // 當前選取具體韻腳 (如 'ang', 'all')      
let currentRhymeType = "all";   // 當前選取韻尾分類 (如 'pure', 'other', 'all')
let currentTone = "all";        // 當前選取聲調 (如 1, 2, 'all')

/**
 * ==========================================
 * DOM 節點快取 (DOM Cache)
 * ==========================================
 * 事先將頻繁使用的網頁元件存入物件，避免在迴圈或事件中重複執行 document.getElementById，大幅提升效能。
 */
const DOM = {
      body: document.body,
      statusBar: document.getElementById("panel-status-bar"),       // 狀態列（顯示載入筆數）
      container: document.getElementById("results-container"),       // 字詞卡片網格容器
      searchWrapper: document.getElementById("search-wrapper"),     // 控制面板外殼
      mainVowelGroup: document.getElementById("main-vowel-group"),   // 主音按鈕群容器
      rhymeGroup: document.getElementById("rhyme-group"),           // 具體韻腳按鈕群容器
      noResultsMessage: document.getElementById("no-results-message"), // 無資料提示字
      dynamicStyle: document.getElementById("dynamic-rhyme-filter"), // 動態注入 CSS 的 <style> 標籤
      toggleBtn: document.getElementById("toggle-panel-btn")        // 面板展開/收折按鈕
};
/**
 * 【UI 控制】切換控制面板展開/收折
 */
DOM.toggleBtn.onclick = function() {
  DOM.searchWrapper.classList.toggle("collapsed");
  
  if (DOM.searchWrapper.classList.contains("collapsed")) {
    // 面板收折：先讓狀態列淡出 (Opacity 0)，200ms 動態結束後再設為 visibility: hidden (防誤觸)
    DOM.statusBar.style.opacity = "0";
    setTimeout(() => { 
      if (DOM.searchWrapper.classList.contains("collapsed")) DOM.statusBar.style.visibility = "hidden"; 
    }, 200);
  } else {
    // 面板展開：立刻顯示並淡入
    DOM.statusBar.style.visibility = "visible";
    DOM.statusBar.style.opacity = "1";
  }
};

/**
 * 【核心演算一】解析臺羅拼音（處理多音節、數字調號、Unicode 組合音標、隱性入聲）
 * @param {string} rawTL - 原始輸入的臺羅音標欄位（可能含註記或多個詞彙音節）
 * @returns {object} - { rhyme: 韻腳字串, tone: 數字調號 }
 */
function parseLastTL(rawTL) {
  // 1. 移除非必要的空白，並使用正規表達式抹除掉諸如「（又讀）」等括號註記
  let cleanTrs = rawTL.trim().toLowerCase().replace(/（.*）/g, ""); 
  
  // 2. 切分多音節詞彙（例如 "tsia̍h-pn̄g"），因為押韻只看最後一個音節
  const syllables = cleanTrs.split(/[\s\-]+/);
  let lastSyllable = syllables[syllables.length - 1].trim();
  
  // 3. 只保留英文字母與特殊 Unicode 音標組合字元
  lastSyllable = lastSyllable.replace(/[^a-z\u0300-\u030d]/g, '');

  if (!lastSyllable) return { rhyme: null, tone: 1 };

  // 4. 情境 A：若是傳統「數字調號」格式（例如 "ann7"）
  const numMatch = lastSyllable.match(/\d+$/);
  if (numMatch) {
    const tone = parseInt(numMatch[0]); // 取得尾部的數字調號
    const pureTL = lastSyllable.replace(/\d+$/, ""); // 移除數字，留下純拼音
    let rhyme = pureTL;
    // 比對聲母清單，將前面的聲母切除，即可抽取出純韻腳
    for (let init of initials) {
      if (pureTL.startsWith(init)) { rhyme = pureTL.slice(init.length); break; }
    }
    return { rhyme, tone };
  }

  // 5. 情境 B：教育部標準「組合音標上標」格式（例如 "nńg"）
  // 使用 NFD (Normalization Form Decomposition) 拆解為「基礎字母 + 音標符號」
  const normalized = lastSyllable.normalize("NFD");
  let tone = 1; // 預設為第 1 聲
  let cleanTL = "";
  
  for (let char of normalized) {
    if (toneMap[char]) { 
      tone = toneMap[char];  // 抓取到調號對應
    } else { 
      cleanTL += char;       // 重新拼回純英文臺羅字串
    }
  }

  // 切除前方聲母，留下純韻腳
  let rhyme = cleanTL;
  for (let init of initials) {
    if (cleanTL.startsWith(init)) { rhyme = cleanTL.slice(init.length); break; }
  }

  // 6. 防呆校正：若韻腳以 p, t, k, h 結尾（入聲字），若無標調，在語言學上對應第 4 聲（中促）或第 8 聲（高促）
  if (["p", "t", "k", "h"].includes(rhyme.slice(-1))) {
    if (tone === 1) tone = 4; // 預設無調號入聲歸為第 4 聲 (中促)
    if (tone === 3) tone = 8; // 輕聲或特定變調入聲歸為第 8 聲 (高促)
  }
  return { rhyme, tone };
}

/**
 * 【核心演算二】語言學韻尾嚴格歸類演算法
 * 負責拆解「核心主音」與判定五大韻尾分類（純母音/鼻化母音/鼻音韻尾/入聲韻/其他）
 * @param {string} rhyme - 純英文字母的韻腳 (例如 'ang', 'ng', 'ann')
 * @returns {object} - { mainVowel: 主音鍵值, rType: 韻尾分類鍵值 }
 */
function extractVowelAndType(rhyme) {
  let mainVowel = "";
  let rType = "other"; // 預設歸類為「其他」，若不滿足前四者，則落入此類

  // 1. 條件分流：判定四大核心韻尾分類
  if (rhyme.endsWith("p") || rhyme.endsWith("t") || rhyme.endsWith("k") || rhyme.endsWith("h")) {
    rType = "checked";      // 入聲韻
  } else if (rhyme.endsWith("nn")) {
    rType = "nasalVowel";   // 鼻化母音
  } else if (rhyme.endsWith("m") || rhyme.endsWith("n") || rhyme.endsWith("ng")) { 
    // 陽聲韻判定：以 m, n, ng 結尾
    rType = "nasalCons";    // 鼻音韻尾
  } else if (/^[aeiou]+$/.test(rhyme)) { 
    // 陰聲韻判定：純母音組成，且中間無任何輔音塞音
    rType = "pure";         // 純母音
  }

  // 2. 主音抽取：特別處理純成音節（如：m, mh, ng, ngh）
  if (rhyme === "m" || rhyme === "mh" || rhyme === "ng" || rhyme === "ngh") {
    mainVowel = "none";    // 歸類於「無主音」
    return { mainVowel, rType };
  }

  // 3. 處理複母音/介音（如 ia, ua, uai），取其後面最關鍵發音的核心主要母音
  let pureVowel = rhyme.charAt(0);
  if (rhyme.startsWith("oo")) {
    pureVowel = "oo";
  } else if ((rhyme.startsWith('i') || rhyme.startsWith('u')) && rhyme.length > 1) {
    const secondChar = rhyme.charAt(1);
    if (rhyme.slice(1).startsWith("oo")) {
      pureVowel = "oo";
    } else if (['a', 'e', 'o', 'u', 'i'].includes(secondChar)) {
      pureVowel = secondChar; // 複母音時，往後取第二位為核心主音
    }
  }

  // 驗證是否在六大母音集內，否則劃歸 none
  if (['a', 'e', 'i', 'o', 'oo', 'u'].includes(pureVowel)) {
    mainVowel = pureVowel;
  } else {
    mainVowel = "none";
  }

  return { mainVowel, rType };
}

/**
 * 【核心防溢出定位演算】在滑鼠移入(Hover)或點擊時，動態計算 Tooltip 彈出視窗是否超出螢幕兩側
 * @param {HTMLElement} card - 當前觸發的字卡 DOM 節點
 */
function adjustTooltipPosition(card) {
  const rect = card.getBoundingClientRect(); // 取得卡片在目前視窗的絕對位置
  const windowWidth = window.innerWidth;
  
  // 先清除舊有的邊緣標記
  card.classList.remove('edge-left', 'edge-right');
  
  // 關鍵判定：如果卡片右側距離視窗右邊界小於 340px (Tooltip 寬 320px + 安全緩衝)
  // 就認定它是最右排卡片，加入 .edge-right 樣式，強迫其 Tooltip 往左側彈出
  if (windowWidth - rect.right < 340) {
    card.classList.add('edge-right');
  } else if (rect.left < 200) {
    card.classList.add('edge-left');
  }
}

/**
 * 使用「事件代理 (Event Delegation)」機制
 * 將點擊事件綁定在父容器 (DOM.container) 上，避免重複對數千個卡片節點綁定監聽器，極大化提升記憶體效能。
 */
DOM.container.addEventListener('click', (e) => {
  const card = e.target.closest('.word-card'); // 向上尋找點擊目標是否屬於字卡
  if (!card || e.target.closest('.word-tooltip')) return; // 若點擊的是 Tooltip 內部則不處理

  const isOpen = card.classList.contains('force-show-tooltip');
  
  // 點擊新卡片時，自動關閉其他已展開的卡片
  const openedCard = DOM.container.querySelector('.word-card.force-show-tooltip');
  if (openedCard) openedCard.classList.remove('force-show-tooltip');

  if (!isOpen) {
      card.classList.add('force-show-tooltip');
      // 在點擊展開時，才即時計算防溢出位置，避免初始隱藏時計算錯誤
        adjustTooltipPosition(card);
    }
    e.stopPropagation(); // 阻止事件冒泡
});
// 滑鼠懸浮 hover 事件代理：滑鼠移入卡片時，即時檢測並動態修正 Tooltip 彈出方向
DOM.container.addEventListener('mouseover', (e) => {
  const card = e.target.closest('.word-card');
  if (!card) return;
  adjustTooltipPosition(card);
});

/**
 * 【資料初始化】非同步下載與主動解析教育部原始巨大 JSON 資料包
 */
async function initSystem() {
  try {
    DOM.statusBar.innerText = "資料載入中...";
    const response = await fetch(DATA_URL);
    const rawData = await response.json();
    // 效能關鍵：建立一個記憶體片段 (DocumentFragment)，所有卡片先塞入 fragment，最後一次性渲染至畫面，避免網頁引發數千次重繪 (Reflow)
    const fragment = document.createDocumentFragment();
    let validCount = 0;
    // 將常規字串合併操作移到迴圈外，加快建立 DOM 時的速度        
    rawData.forEach(item => {
      if (!item.title || !item.heteronyms) return; // 過濾掉殘缺資料
      
      item.heteronyms.forEach(het => {
        if (!het.trs) return; // 跳過無拼音欄位的資料
        
        // 若有多個讀音選項（用逗號或斜線分隔），預設擷取第一個標準讀音進行解算
        const firstTrsOption = het.trs.split(/[,/、]/)[0].trim();
        if (!firstTrsOption) return;
        
        const { rhyme, tone } = parseLastTL(firstTrsOption); // 呼叫核心演算法一：拆解出韻腳與調號
        
        if (rhyme) {
          let structuredDefinitions = [];

          // 解析與清洗釋義段落，同時處理教育部特有的多層級例句格式控制碼 (\uFFF9 系列)
          if (het.definitions && het.definitions.length > 0) {
            het.definitions.forEach(defItem => {
              let defText = defItem.def ? defItem.def.replace(/[\[\]]/g, "") : "暫無釋義";
              let defType = defItem.type || "";
              let examplesArray = [];

              if (defItem.example && defItem.example.length > 0) {
                defItem.example.forEach(rawEx => {
                  const cleanEx = rawEx.replace(/[\uFFFC]+/g, "").trim(); 
                  const parts = cleanEx.split(/[\uFFF9\uFFFA\uFFFB]+/); // 針對特殊字元進行例句三元拆解
                  
                  if (parts.length >= 4) {
                    examplesArray.push({
                      hanzi: parts[1].trim(),     // 漢字例句
                      romaji: parts[2].trim(),    // 臺羅拼音
                      mandarin: parts[3].trim()  // 華語對譯
                    });
                  } else if (parts.length === 3) {
                    examplesArray.push({
                      hanzi: parts[0].trim(),
                      romaji: parts[1].trim(),
                      mandarin: parts[2].trim()
                    });
                  } else if (cleanEx) {
                    examplesArray.push({ hanzi: cleanEx, romaji: "", mandarin: "" });
                  }
                });
              }

              // 封裝成乾淨的結構物件
              structuredDefinitions.push({
                type: defType,
                def: defText,
                examples: examplesArray
              });
            });
          } else {
            structuredDefinitions.push({ type: "", def: "暫無釋義", examples: [] });
          }

          // 執行核心算法二：進行主音與類型的語言學分揀
          const { mainVowel, rType } = extractVowelAndType(rhyme);

          // 建立卡片元件，並將所有分流標籤寫入 DOM 的 dataset 屬性中，供後續 CSS 一鍵篩選
          const card = document.createElement("div");
          card.className = "word-card";
          card.setAttribute("data-vowel", mainVowel);
          card.setAttribute("data-type", rType);
          card.setAttribute("data-rhyme", rhyme);
          card.setAttribute("data-tone", tone);
          
          // 串接字卡內部的釋義 HTML
          let definitionsHTML = "";
          structuredDefinitions.forEach((defItem, dIdx) => {
            let examplesHTML = "";
            if (defItem.examples && defItem.examples.length > 0) {
              examplesHTML = `<div class="tooltip-ex-container">`;
              defItem.examples.forEach(ex => {
                examplesHTML += `
                  <div class="tooltip-ex-box">
                    <div class="ex-hanzi">例：${ex.hanzi}</div>
                    ${ex.romaji ? `<div class="ex-romaji">${ex.romaji}</div>` : ''}
                    ${ex.mandarin ? `<div class="ex-mandarin">（${ex.mandarin}）</div>` : ''}
                  </div>
                `;
              });
              examplesHTML += `</div>`;
            }
            const typeTag = defItem.type ? `<span class="def-type">${defItem.type}</span>` : "";
            definitionsHTML += `
              <div class="definition-block">
                <div class="tooltip-def">${structuredDefinitions.length > 1 ? (dIdx + 1) + '. ' : ''}${typeTag}${defItem.def}</div>
                ${examplesHTML}
              </div>
            `;
          });

          // 填入字卡完整的內部結構
          card.innerHTML = `
            <div class="word-title">${item.title}</div>
            <div class="word-TL">${het.trs}</div>
            <div class="word-info">
              <div class="word-info-row">
                <span>韻腳: ${rhyme}</span>
                <span>第 ${tone} 聲</span>
              </div>
              <div class="word-info-row" style="color: #8da193; font-size: 0.75rem; padding-top: 2px;">
                <span>${typeLabelMap[rType]}</span>
              </div>
            </div>
            <div class="word-tooltip">${definitionsHTML}</div>
          `;

          fragment.appendChild(card);// 塞入節點片段
          validCount++;
          
          // 建立動態巢狀字典索引，供 UI 連動選單使用
          if (!rhymeDictionary[mainVowel]) {
            rhymeDictionary[mainVowel] = {};
          }
          rhymeDictionary[mainVowel][rhyme] = rType;
        }
      });
    });

    // 將所有卡片一次性倒進網頁容器中
    DOM.container.appendChild(fragment); 
    DOM.statusBar.innerText = `載入完成 (${validCount} 筆)`;
    buildUI(); // 驅動建置前端按鈕元件與選單連動
    
  } catch (error) {
    console.error(error);
    DOM.statusBar.innerText = "資料載入失敗";
  }
}

/**
 * 【UI 渲染一】建置主音、韻尾、聲調之按鈕骨架與事件綁定
 */
function buildUI() {
  DOM.mainVowelGroup.innerHTML = "";

  // 生成「全部主音」預設膠囊按鈕
  const allVowelBtn = document.createElement("button");
  allVowelBtn.className = "filter-choice-btn active";
  allVowelBtn.innerText = "全部主音";
  allVowelBtn.onclick = () => {
    DOM.mainVowelGroup.querySelector("button.active")?.classList.remove("active");
    allVowelBtn.classList.add("active");
    currentMainVowel = "all";
    currentRhyme = "all";         // 重置韻腳狀態
    updateRhymeOptions();         // 更新第三排具體韻腳選單
    applyFilterAttributes();      // 執行篩選器
  };
  DOM.mainVowelGroup.appendChild(allVowelBtn);

  // 排序 A, E, I, O, OO, U，並將【無主音】挪移至最末端
  const sortedVowels = Object.keys(rhymeDictionary).sort((a,b) => {
    const order = { 'a':1, 'e':2, 'i':3, 'o':4, 'oo':5, 'u':6, 'none':7 };
    return (order[a] || 99) - (order[b] || 99);
  });

  // 動態生成核心主音膠囊按鈕
  sortedVowels.forEach((vowel) => {
    const btn = document.createElement("button");
    btn.className = "filter-choice-btn";
    
    if (vowel === "none") {
      btn.innerText = `無主音`;
    } else if (vowel === "oo") {
      btn.innerText = `OO 主音系列`;
    } else {
      btn.innerText = `${vowel.toUpperCase()} 主音系列`;
    }
    
    // 點擊主音事件：重置下游韻腳狀態、重繪選單並重刷篩選結果
    btn.onclick = () => {
      DOM.mainVowelGroup.querySelector("button.active")?.classList.remove("active");
      btn.classList.add("active");
      currentMainVowel = vowel;
      currentRhyme = "all"; 
      updateRhymeOptions();  
      applyFilterAttributes(); 
    };
    DOM.mainVowelGroup.appendChild(btn);
  });

  // 「韻尾分類」群組的點擊代理監聽
  const typeContainer = document.getElementById("rhyme-type-group");
  typeContainer.onclick = (e) => {
    const btn = e.target.closest('.type-btn');
    if (!btn || btn.classList.contains('active')) return;
    typeContainer.querySelector('.type-btn.active')?.classList.remove('active');
      btn.classList.add("active");
      currentRhymeType = btn.getAttribute("data-type");
      currentRhyme = "all"; // 切換大分類時，第三排具體韻腳必須回歸「all」
      
      updateRhymeOptions(); 
      applyFilterAttributes();
  };

  // 綁定「聲調篩選」按鈕群的點擊連動監聽
  const toneContainer = document.getElementById("tone-group");
  toneContainer.onclick = (e) => {
    const btn = e.target.closest('.tone-btn');
    if (!btn || btn.classList.contains('active')) return;
    toneContainer.querySelector('.tone-btn.active')?.classList.remove('active');
    btn.classList.add("active");
    currentTone = btn.getAttribute("data-tone");
    applyFilterAttributes();// 聲調改變不影響韻腳選單，直接刷新篩選結果即可
  };

  // 首次載入的主動同步
  updateRhymeOptions();
  applyFilterAttributes();
  setupEdgeObserver(); 
}

/**
 * 【UI 渲染二】核心連動機制：根據當前「核心主音」與「韻尾分類」動態生成第三排的「具體韻腳」
 */
function updateRhymeOptions() {
  DOM.rhymeGroup.innerHTML = "";

  // 如果選了核心主音「全部主音」、韻尾分類「全部不分類」，先提示使用者縮小範圍
  if (currentMainVowel === "all" && currentRhymeType === "all") {
    DOM.rhymeGroup.innerHTML = `<span style="color:#7a8e81; font-size:0.9rem;">請選擇特定核心主音以顯示具體韻腳</span>`;
    return;
  }

  let filteredRhymes = []; // 收集符合篩選條件的具體韻腳

  if (currentMainVowel !== "all") {
    // 情境 A：使用者有指定的主音系列

    const rhymeMap = rhymeDictionary[currentMainVowel] || {};
  
    // 進行雙重條件交叉篩選，找出匹配當前大類目的具體韻腳字串
    filteredRhymes = Object.keys(rhymeMap).filter(rhyme => {
      if (currentRhymeType === "all") return true; // 若選取全部不分類，無條件放行
      return rhymeMap[rhyme] === currentRhymeType;
    });
  } else {
    // 情境 B：選取「全部主音」，但有指定「特定韻尾分類」
    // 走訪所有主音，撈出該分類下的所有韻腳並進行 Set 消除重複項目
    const uniqueSet = new Set();
    Object.keys(rhymeDictionary).forEach(vowel => {
      const rhymeMap = rhymeDictionary[vowel] || {};
      Object.keys(rhymeMap).forEach(rhyme => {
        if (rhymeMap[rhyme] === currentRhymeType) {
          uniqueSet.add(rhyme);
        }
      });
    });
    // 消除重複項目，避免不同主音有相同的韻腳名稱
    filteredRhymes = Array.from(uniqueSet);
  }

  filteredRhymes.sort(); // 按字母排序具體韻腳
  
  // 生成「全部具體韻腳」預設通用膠囊
  const allRhymesBtn = document.createElement("button");
  allRhymesBtn.className = "filter-choice-btn";
  allRhymesBtn.innerText = "全部具體韻腳";
  
  if (currentRhyme === "all") {
    allRhymesBtn.classList.add("active");
  }
  
  allRhymesBtn.onclick = () => {
    DOM.rhymeGroup.querySelectorAll("#rhyme-group button").forEach(b => b.classList.remove("active"));
    allRhymesBtn.classList.add("active");
    currentRhyme = "all";
    applyFilterAttributes();
  };
  DOM.rhymeGroup.appendChild(allRhymesBtn);

  // 若該分類下無內容（例如 I 主音系列下可能沒有 other 分類），給予溫和提示
  if (filteredRhymes.length === 0) {
    const tip = document.createElement("span");
    tip.style.cssText = "color:#b85a38; font-size:0.85rem; padding-left:4px; font-weight:600;";
    tip.innerText = "該分類下無對應韻腳";
    DOM.rhymeGroup.appendChild(tip);
    return;
  }

  // 利用 DocumentFragment 生成具體的韻腳按鈕（例如：ang, ak, am）
  const rhymeBtnFragment = document.createDocumentFragment();
  filteredRhymes.forEach((rhyme) => {
    const btn = document.createElement("button");
    btn.className = "filter-choice-btn";
    btn.innerText = rhyme;
    
    if (currentRhyme === rhyme) {
      btn.classList.add("active");
    }
    
    btn.onclick = () => {
      DOM.rhymeGroup.querySelector("button.active")?.classList.remove("active");
      btn.classList.add("active");
      currentRhyme = rhyme;
      applyFilterAttributes(); 
    };
    rhymeBtnFragment.appendChild(btn);
  });
    DOM.rhymeGroup.appendChild(rhymeBtnFragment);
}

/**
 * 【UI 渲染三】動態覆寫唯一 CSS 規則，達成極速隱藏/顯示字卡
 */
function applyFilterAttributes() {
  const body = DOM.body;
  // 將當前狀態同步回寫到 body 的 data-屬性，方便 CSS 追蹤
  body.setAttribute("data-cur-vowel", currentMainVowel);
  body.setAttribute("data-cur-type", currentRhymeType);
  body.setAttribute("data-cur-tone", currentTone);
  body.setAttribute("data-cur-rhyme", currentRhyme);

  // 1. 預設規則：將網格內所有卡片全數隱藏 (!important 覆蓋)
  let cssRules = `.word-card { display: none !important; }`;

  // 2. 建立精準的動態聯動放行規則（Selector）
  let vowelSelector = currentMainVowel !== "all" ? `[data-vowel="${currentMainVowel}"]` : "";
  let typeSelector = currentRhymeType !== "all" ? `[data-type="${currentRhymeType}"]` : "";
  let toneSelector = currentTone !== "all" ? `[data-tone="${currentTone}"]` : "";
  let rhymeSelector = currentRhyme !== "all" ? `[data-rhyme="${currentRhyme}"]` : "";

  // 3. 組合出最高權重的放行令：只有同時符合當前所有「非 all」條件的卡片才會顯示
  cssRules += `
    .word-card${vowelSelector}${typeSelector}${toneSelector}${rhymeSelector} { 
      display: flex !important; 
    }
  `;

  // 4. 加入樣式表，完成篩選
  DOM.dynamicStyle.innerHTML = cssRules;

  // 使用 querySelector 動態偵測目前畫面上還有沒有符合條件的卡片
  const selector = `.word-card${vowelSelector}${typeSelector}${toneSelector}${rhymeSelector}`;
  const hasVisibleCard = DOM.container.querySelector(selector) !== null;
  DOM.noResultsMessage.style.display = hasVisibleCard ? 'none' : 'block';
}

/**
 * 全域事件與防禦監聽引擎 (Global Event Observers)
 */
function setupEdgeObserver() {
  // 1. 全域點擊防禦：點擊網頁任何空白處，自動關閉目前展開的 Tooltip
  document.addEventListener('click', () => {
    const openedCard = DOM.container.querySelector('.word-card.force-show-tooltip');
    if (openedCard) openedCard.classList.remove('force-show-tooltip');
  });

  // 2. 視窗縮放防禦：防止瀏覽器旋轉/縮放時，舊有的 Tooltip 溢出定位標記殘留導致錯位
  window.addEventListener('resize', () => {
    const edgeCards = DOM.container.querySelectorAll('.word-card.edge-right, .word-card.edge-left');
    edgeCards.forEach(card => card.classList.remove('edge-left', 'edge-right'));
  });
}

// 網頁載入完畢，立刻啟動非同步初始化流程
window.onload = initSystem;