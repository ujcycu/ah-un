// 資料來源
const DATA_URL = "data.json";

// 台語常見聲母表，比對拼音開頭，剝離前方聲母以取出韻尾， 順序由長至短排列
const initials = ["tsh", "ts", "ph", "th", "kh", "ng", "m", "p", "t", "k", "g", "b", "l", "h", "s", "j", "n"];

// Unicode 組合音標（NFD 格式）與標準台語調號的對應表
const toneMap = { '\u0301': 2, '\u0300': 3, '\u0302': 5, '\u0306': 6, '\u0304': 7, '\u030d': 8 };

// 介面標籤（韻尾分類）的中文對照表
const typeLabelMap = {
  "pure": "純母音",         // 如：a, i, u, oo
  "nasalVowel": "鼻化母音",  // 如：ann, inn
  "nasalCons": "鼻音韻尾",   // 如：am, an, ang
  "checked": "入聲韻",      // 以 p, t, k, h 結尾
  "other": "其他"          // 無法歸入上述四類的特殊情況
};

// 全域狀態記憶體
let rhymeDictionary = {};       // 巢狀索引結構：{ 核心主音: { 具體韻尾: 韻尾分類 } }，加速 UI 生成
let currentMainVowel = "all";   // 當前選取主音 (如 'a', 'e', 'none', 'all')
let currentRhyme = "all";       // 當前選取具體韻尾 (如 'ang', 'all')      
let currentRhymeType = "all";   // 當前選取韻尾分類 (如 'pure', 'other', 'all')
let currentTone = "all";        // 當前選取聲調 (如 1, 2, 'all')

// 記憶體快取：紀錄畫面上各條件組合的卡片總數，用來極速判定有沒有「無資料」的情境
let filterCounter = {};

const DOM = {
      body: document.body,
      statusBar: document.getElementById("panel-status-bar"),       // 狀態列（顯示載入筆數）
      container: document.getElementById("results-container"),       // 字詞卡片網格容器
      searchWrapper: document.getElementById("search-wrapper"),     // 控制面板外殼
      mainVowelGroup: document.getElementById("main-vowel-group"),   // 主音按鈕群容器
      rhymeGroup: document.getElementById("rhyme-group"),           // 具體韻尾按鈕群容器
      noResultsMessage: document.getElementById("no-results-message"), // 無資料提示字
      dynamicStyle: document.getElementById("dynamic-rhyme-filter"), // 動態注入 CSS 的 <style> 標籤
      toggleBtn: document.getElementById("toggle-panel-btn")        // 面板展開/收折按鈕
};

/**
 * 【UI 控制】切換控制面板展開/收折
 */
DOM.toggleBtn.addEventListener('click', () => {
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
});

/**
 * 【核心演算一】解析臺羅拼音（Unicode 幽靈字元淨化與聲調分離演算法）
 * 先切出整塊末端詞。延後處理連字號。
 */
function parseLastTL(sentence) {
    let finalFound = "";
    let detectedTone = 1;
    let rType = "pure";

    if (!sentence || !sentence.trim()) {
        return { rhyme: '', tone: 1, mainVowel: '', rType: 'pure' };
    }

    // 1. 用空白切開句子，拿到最後一串（如 "it-to-lióng-tuān"）
    const textSegments = sentence.trim().toLowerCase().split(/\s+/);
    const lastSegment = textSegments[textSegments.length - 1]; 

    // 2. 用連字號切開，直接鎖定最後一個音節（如 "tuān"）
    const temporarySyllables = lastSegment.split('-');
    const targetSyllable = temporarySyllables[temporarySyllables.length - 1]; // 拿到純粹的 "tuān"

    // 3. 對「目標音節」進行 Unicode NFD 規範化打散
    const nfdSegment = targetSyllable.normalize("NFD");

    // 4. 聲調精準攔截（只對最後一個音節判斷，並採用高優先權防禦）
    if (nfdSegment.match(/\u0302/)) detectedTone = 5;      // 第 5 聲，如 lâng
    else if (nfdSegment.match(/\u0301/)) detectedTone = 2; // 第 2 聲，如 lióng
    else if (nfdSegment.match(/\u0300/)) detectedTone = 3; // 第 3 聲，如 jiàu
    else if (nfdSegment.match(/\u0304/)) detectedTone = 7; // 第 7 聲，如 tuān 
    else if (nfdSegment.match(/[\u030d\u030b̍]/)) detectedTone = 8; // 第 8 聲，如 tsa̍p

    // 5. 排除幽靈字元與調號，留下純字母
    let cleanSyllable = "";
    for (let i = 0; i < nfdSegment.length; i++) {
        const char = nfdSegment[i];
        const code = char.charCodeAt(0);
        if (code >= 97 && code <= 122) { // 只留 a-z
            cleanSyllable += char;
        }
    } // 得到 "tuan"

    // 6. 拆除聲母以取出韻尾
    finalFound = cleanSyllable; // 預設整個音節皆為韻母

    if (cleanSyllable !== "ng" && cleanSyllable !== "m") { 
        for (const init of initials) {
            if (cleanSyllable.startsWith(init)) {
                finalFound = cleanSyllable.substring(init.length); // "tuan" -> 切出 "uan"
                break;
            }
        }
    }

    // 7. 判定入聲調
    if (/[ptkh]$/.test(finalFound)) { // p, t, k, h 結尾
        rType = "checked"; 
        if (detectedTone === 1) detectedTone = 4; // 更新為第 4 調
    }

    // 8. 回傳
    const linguistics = extractVowelAndType(finalFound);
    return {
        rhyme: finalFound,          
        tone: detectedTone,         
        mainVowel: linguistics.mainVowel,       
        rType: rType === "checked" ? "checked" : linguistics.rType               
    };
}

/**
 * 【核心演算二】語言學韻尾歸類演算法
 */
function extractVowelAndType(rhyme) {
  let mainVowel = "";
  let rType = "other";

  if (!rhyme) return { mainVowel: "none", rType: "other" };

  // 1. 判定五大韻尾分類
  if (rhyme.endsWith("p") || rhyme.endsWith("t") || rhyme.endsWith("k") || rhyme.endsWith("h")) {
    rType = "checked";      // 入聲韻
  } else if (rhyme.endsWith("nn")) {
    rType = "nasalVowel";   // 鼻化母音
  } else if (rhyme.endsWith("m") || rhyme.endsWith("n") || rhyme.endsWith("ng")) { 
    rType = "nasalCons";    // 鼻音韻尾
  } else if (/^[aeiou]+$/.test(rhyme)) { 
    rType = "pure";         // 純母音 (此時 "i" 完美命中並順利歸類)
  }

  // 2. 主音抽取：處理純成音節（如：m, mh, ng, ngh），此時無傳統母音
  if (/^(m|ng)(h)?$/.test(rhyme)) {
    return { mainVowel: "none", rType };
  }

  // 3. 處理複母音/介音
  // 先把韻尾與鼻化符號拿掉，只留下純母音字母串 (例如 "uainn" -> "uai")
  const pureVowelsClean = rhyme.replace(/[ptkhmng]+$/, "").replace(/nn$/, "");
  if (!pureVowelsClean) {
    return { mainVowel: "none", rType };
  }

  // 調符優先順序為：a > oo > e,o > i,u。
  if (pureVowelsClean.includes("a")) {
    mainVowel = "a"; // 第一順位 a (包含 a, ia, ua, ai, ainn, uainn)
  } else if (pureVowelsClean.includes("oo")) {
    mainVowel = "oo"; // 第二順位 oo（如 oonn, ioo）
  } else if (pureVowelsClean.includes("o")) {
    mainVowel = "o"; // 第三順位 o (包含 o, io, oe)
  } else if (pureVowelsClean.includes("e")) {
    mainVowel = "e"; // 第三順位 e (包含 e, ie, ue)
  } else if (pureVowelsClean.includes("i") && pureVowelsClean.includes("u")) {
    mainVowel = pureVowelsClean.charAt(pureVowelsClean.length - 1); // 第四順位的複母音用最後母音 (包含 iu, ui)
  } else if (pureVowelsClean.includes("i")) {
    mainVowel = "i"; // 第四順位
  } else if (pureVowelsClean.includes("u")) {
    mainVowel = "u"; // 第四順位
  } else {
    mainVowel = "none";
  }

  return { mainVowel, rType };
}

/**
 * 【UI 輔助】核心防溢出定位演算
 * 防止彈出的釋義視窗（Tooltip）在視窗左右兩側被遮擋切斷。
 */
function adjustTooltipPosition(card) {
  const rect = card.getBoundingClientRect();
  const windowWidth = window.innerWidth;
  
  card.classList.remove('edge-left', 'edge-right');
  
  if (windowWidth - rect.right < 340) {
    card.classList.add('edge-right'); // 靠右防護
  } else if (rect.left < 200) {
    card.classList.add('edge-left');  // 靠左防護
  }
}

// 事件代理：點擊字卡顯示/隱藏釋義
DOM.container.addEventListener('click', (e) => {
  const card = e.target.closest('.word-card');
  if (!card || e.target.closest('.word-tooltip')) return;

  const isOpen = card.classList.contains('force-show-tooltip');
  const openedCard = DOM.container.querySelector('.word-card.force-show-tooltip');
  if (openedCard) openedCard.classList.remove('force-show-tooltip');

  if (!isOpen) {
    card.classList.add('force-show-tooltip');
    adjustTooltipPosition(card);
  }
  e.stopPropagation();
});

// 事件代理：滑鼠懸浮時預先修正 Tooltip 邊界位置
DOM.container.addEventListener('mouseover', (e) => {
  const card = e.target.closest('.word-card');
  if (!card) return;
  adjustTooltipPosition(card);
});

/**
 * 【資料初始化】從 JSON 格式建立索引字典與 DOM 卡片
 */
async function initSystem() {
  try {
    DOM.statusBar.innerText = "資料載入中...";
    const response = await fetch(DATA_URL);
    const rawData = await response.json();
    const fragment = document.createDocumentFragment();
    let validCount = 0;
        
    rawData.forEach(item => {
      if (!item.title || !item.trs) return; 
      
      let firstTrsOption = item.trs.trim();

      // 短詞與長句智慧分流：長句不進行多重音讀切分，避免破壞結構
      const isLongSentence = firstTrsOption.includes(",") || (firstTrsOption.split(" ").length > 2);

      if (!isLongSentence) {
        // 多音讀分流放行（例如 "peh-jī/pueh-lī" 優先抓取斜線前方的第一發核心音讀）
        if (firstTrsOption.includes('/') || firstTrsOption.includes('、')) {
          firstTrsOption = firstTrsOption.split(/[/、]/)[0].trim();
        } else if (firstTrsOption.includes(',')) {
          firstTrsOption = firstTrsOption.split(',')[0].trim();
        }
      }

      if (!firstTrsOption) return;
      
      // 調用物理級 parseLastTL 抽取最後音節與聲調
      const { rhyme, tone } = parseLastTL(firstTrsOption);
      
      if (rhyme) {
        // 調用語言學演算法抽取核心主音與韻尾類型
        const { mainVowel, rType } = extractVowelAndType(rhyme);

        // 快取計數器，用來加強後續「無資料提示」的 CSS 判定效能
        const token = `${mainVowel}_${rType}_${rhyme}_${tone}`;
        filterCounter[token] = (filterCounter[token] || 0) + 1;

        // 解析新舊相容結構的 definitions 與 examples 元件
        let definitionsHTML = "";
        const targetDefinitions = item.definitions || (item.heteronyms && item.heteronyms[0]?.definitions) || [];

        if (targetDefinitions.length > 0) {
          targetDefinitions.forEach((defItem, dIdx) => {
            let examplesHTML = "";
            
            if (defItem.example && defItem.example.length > 0) {
              examplesHTML = `<div class="tooltip-ex-container">`;
              defItem.example.forEach(ex => {
                if (typeof ex === 'object') {
                  examplesHTML += `
                    <div class="tooltip-ex-box">
                      <div class="ex-hanzi">例：${ex.hanzi || ''}</div>
                      ${ex.romaji ? `<div class="ex-romaji">${ex.romaji}</div>` : ''}
                      ${ex.translation ? `<div class="ex-mandarin">（${ex.translation}）</div>` : ''}
                    </div>`;
                } else {
                  // 處理特殊隱形分隔符相容機制
                  const cleanEx = ex.replace(/[\uFFFC]+/g, "").trim(); 
                  const parts = cleanEx.split(/[\uFFF9\uFFFA\uFFFB\￺￻]+/); 
                  const hanzi = parts[1] || parts[0] || "";
                  const romaji = parts[2] || "";
                  const mandarin = parts[3] || "";
                  examplesHTML += `
                    <div class="tooltip-ex-box">
                      <div class="ex-hanzi">例：${hanzi.trim()}</div>
                      ${romaji ? `<div class="ex-romaji">${romaji.trim()}</div>` : ''}
                      ${mandarin ? `<div class="ex-mandarin">（${mandarin.trim()}）</div>` : ''}
                    </div>`;
                }
              });
              examplesHTML += `</div>`;
            }
            
            const typeTag = defItem.type ? `<span class="def-type">${defItem.type}</span>` : "";
            definitionsHTML += `
              <div class="definition-block">
                <div class="tooltip-def">${targetDefinitions.length > 1 ? (dIdx + 1) + '. ' : ''}${typeTag}${defItem.def || '暫無釋義'}</div>
                ${examplesHTML}
              </div>`;
          });
        } else {
          definitionsHTML = `<div class="definition-block"><div class="tooltip-def">暫無釋義</div></div>`;
        }

        // 建立快取字卡並寫入專屬 data 屬性，供後續動態 CSS 篩選定位
        const card = document.createElement("div");
        card.className = "word-card";
        card.setAttribute("data-vowel", mainVowel);
        card.setAttribute("data-type", rType);
        card.setAttribute("data-rhyme", rhyme);
        card.setAttribute("data-tone", tone);
        
        card.innerHTML = `
          <div class="word-title">${item.title}</div>
          <div class="word-TL">${item.trs}</div>
          <div class="word-info">
            <div class="word-info-row">
              <span>韻尾: ${rhyme}</span>
              <span>第 ${tone} 聲</span>
            </div>
            <div class="word-info-row" style="color: #8da193; font-size: 0.75rem; padding-top: 2px;">
              <span>${typeLabelMap[rType]}</span>
            </div>
          </div>
          <div class="word-tooltip">${definitionsHTML}</div>
        `;

        fragment.appendChild(card);
        validCount++;
        
        // 將資料註冊至巢狀字典記憶體中，供篩選面板動態建置 UI
        if (!rhymeDictionary[mainVowel]) {
          rhymeDictionary[mainVowel] = {};
        }
        rhymeDictionary[mainVowel][rhyme] = rType;
      }
    });

    DOM.container.appendChild(fragment); 
    DOM.statusBar.innerText = `載入完成 (${validCount} 筆)`;
    buildUI();
    
  } catch (error) {
    console.error(error);
    DOM.statusBar.innerText = "資料載入失敗";
  }
}

/**
 * 【UI 渲染一】建置篩選按鈕骨架（核心主音、韻尾分類、聲調群組）與事件代理
 */
function buildUI() {
  DOM.mainVowelGroup.innerHTML = "";

  // 1. 建置「全部主音」按鈕
  const allVowelBtn = document.createElement("button");
  allVowelBtn.className = "filter-choice-btn active";
  allVowelBtn.innerText = "全部主音";
  allVowelBtn.onclick = () => {
    DOM.mainVowelGroup.querySelector("button.active")?.classList.remove("active");
    allVowelBtn.classList.add("active");
    currentMainVowel = "all";
    currentRhyme = "all";
    updateRhymeOptions();
    applyFilterAttributes();
  };
  DOM.mainVowelGroup.appendChild(allVowelBtn);

  // 2. 排序並依序建置個別主音系列按鈕
  const sortedVowels = Object.keys(rhymeDictionary).sort((a,b) => {
    const order = { 'a':1, 'e':2, 'i':3, 'o':4, 'oo':5, 'u':6, 'none':7 };
    return (order[a] || 99) - (order[b] || 99);
  });

  sortedVowels.forEach((vowel) => {
    const btn = document.createElement("button");
    btn.className = "filter-choice-btn";
    
    if (vowel === "none") {
      btn.innerText = `無主音`;
    } else {
      btn.innerText = `${vowel.toUpperCase()} 主音系列`;
    }
    
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

  // 3. 韻尾分類點擊監聽
  const typeContainer = document.getElementById("rhyme-type-group");
  typeContainer.onclick = (e) => {
    const btn = e.target.closest('.type-btn');
    if (!btn || btn.classList.contains('active')) return;
    typeContainer.querySelector('.type-btn.active')?.classList.remove('active');
    btn.classList.add("active");
    currentRhymeType = btn.getAttribute("data-type");
    currentRhyme = "all"; 
    updateRhymeOptions(); 
    applyFilterAttributes();
  };

  // 4. 聲調群組點擊監聽
  const toneContainer = document.getElementById("tone-group");
  toneContainer.onclick = (e) => {
    const btn = e.target.closest('.tone-btn');
    if (!btn || btn.classList.contains('active')) return;
    toneContainer.querySelector('.tone-btn.active')?.classList.remove('active');
    btn.classList.add("active");
    currentTone = btn.getAttribute("data-tone");
    applyFilterAttributes();
  };

  updateRhymeOptions();
  applyFilterAttributes();
  setupEdgeObserver(); 
}

/**
 * 【UI 渲染二】根據當前選取的核心主音與韻尾分類，動態生成第三排「具體韻尾」按鈕群組
 */
function updateRhymeOptions() {
  DOM.rhymeGroup.innerHTML = "";

  if (currentMainVowel === "all" && currentRhymeType === "all") {
    DOM.rhymeGroup.innerHTML = `<span style="color:#7a8e81; font-size:0.9rem;">請選擇特定核心主音以顯示具體韻尾</span>`;
    return;
  }

  let filteredRhymes = [];

  if (currentMainVowel !== "all") {
    const rhymeMap = rhymeDictionary[currentMainVowel] || {};
    filteredRhymes = Object.keys(rhymeMap).filter(rhyme => {
      if (currentRhymeType === "all") return true;
      return rhymeMap[rhyme] === currentRhymeType;
    });
  } else {
    const uniqueSet = new Set();
    Object.keys(rhymeDictionary).forEach(vowel => {
      const rhymeMap = rhymeDictionary[vowel] || {};
      Object.keys(rhymeMap).forEach(rhyme => {
        if (rhymeMap[rhyme] === currentRhymeType) {
          uniqueSet.add(rhyme);
        }
      });
    });
    filteredRhymes = Array.from(uniqueSet);
  }

  filteredRhymes.sort();
  
  const allRhymesBtn = document.createElement("button");
  allRhymesBtn.className = "filter-choice-btn";
  allRhymesBtn.innerText = "全部具體韻尾";
  if (currentRhyme === "all") allRhymesBtn.classList.add("active");
  
  allRhymesBtn.onclick = () => {
    DOM.rhymeGroup.querySelectorAll("#rhyme-group button").forEach(b => b.classList.remove("active"));
    allRhymesBtn.classList.add("active");
    currentRhyme = "all";
    applyFilterAttributes();
  };
  DOM.rhymeGroup.appendChild(allRhymesBtn);

  if (filteredRhymes.length === 0) {
    const tip = document.createElement("span");
    tip.style.cssText = "color:#b85a38; font-size:0.85rem; padding-left:4px; font-weight:600;";
    tip.innerText = "該分類下無對應韻尾";
    DOM.rhymeGroup.appendChild(tip);
    return;
  }

  const rhymeBtnFragment = document.createDocumentFragment();
  filteredRhymes.forEach((rhyme) => {
    const btn = document.createElement("button");
    btn.className = "filter-choice-btn";
    btn.innerText = rhyme;
    if (currentRhyme === rhyme) btn.classList.add("active");
    
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
 * 【UI 渲染三】動態覆寫 CSS 規則，與無資料狀態判定
 */
function applyFilterAttributes() {
  const body = DOM.body;
  body.setAttribute("data-cur-vowel", currentMainVowel);
  body.setAttribute("data-cur-type", currentRhymeType);
  body.setAttribute("data-cur-tone", currentTone);
  body.setAttribute("data-cur-rhyme", currentRhyme);

  // 預設將所有卡片在 CSS 層面強制隱藏
  let cssRules = `.word-card { display: none !important; }`;

  let vowelSelector = currentMainVowel !== "all" ? `[data-vowel="${currentMainVowel}"]` : "";
  let typeSelector = currentRhymeType !== "all" ? `[data-type="${currentRhymeType}"]` : "";
  let toneSelector = currentTone !== "all" ? `[data-tone="${currentTone}"]` : "";
  let rhymeSelector = currentRhyme !== "all" ? `[data-rhyme="${currentRhyme}"]` : "";

  // 若符合當前 Attribute 的字卡則放行顯示
  cssRules += `
    .word-card${vowelSelector}${typeSelector}${toneSelector}${rhymeSelector} { 
      display: flex !important; 
    }
  `;
  DOM.dynamicStyle.innerHTML = cssRules;

  // 使用初始化時建立的快取計數器（Token Counter）進行狀態對位。
  // 藉由資料層（Data Layer）的雜湊查表，以 O(1) 的時間複雜度，在毫秒內判定當前篩選組合是否存在對應結果。
  let hasVisibleCard = false;
  for (const token in filterCounter) {
    const [v, t, r, tn] = token.split('_');
    if (currentMainVowel !== 'all' && v !== currentMainVowel) continue;
    if (currentRhymeType !== 'all' && t !== currentRhymeType) continue;
    if (currentRhyme !== 'all' && r !== currentRhyme) continue;
    if (currentTone !== 'all' && tn !== currentTone) continue;
    
    if (filterCounter[token] > 0) {
      hasVisibleCard = true;
      break;
    }
  }
  DOM.noResultsMessage.style.display = hasVisibleCard ? 'none' : 'block';
}

/**
 * 全域事件與防禦監聽引擎
 */
function setupEdgeObserver() {
  // 點擊卡片以外的空白處，自動收折已展開的釋義視窗
  document.addEventListener('click', () => {
    const openedCard = DOM.container.querySelector('.word-card.force-show-tooltip');
    if (openedCard) openedCard.classList.remove('force-show-tooltip');
  });

  // 視窗尺寸改變時重置 Tooltip 左右側防撞邊界快取
  window.addEventListener('resize', () => {
    const edgeCards = DOM.container.querySelectorAll('.word-card.edge-right, .word-card.edge-left');
    edgeCards.forEach(card => card.classList.remove('edge-left', 'edge-right'));
  });
}

// 綁定視窗載入事件，發動 initSystem 引擎
window.onload = initSystem;