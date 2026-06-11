// 可放在JS最後做測試
function runSyllableSystemTest() {
    console.log("=== 🚀 開始執行台語韻腳解析系統壓力測試 ===");

    // 測試案例：包含各種隱形字元、連字號、特殊聲調與 ji 韻
    const testCases = [
        {
            name: "1. 經典大魔王（一枝草一點露，含 NFD 與隱形字元）",
            input: "Tsi̍t ki tsháu, tsi̍t tiám lōo.", // 模擬你原本有髒資料的字串
            expectedRhyme: "oo",
            expectedTone: 7,
            expectedVowel: "oo",
            expectedType: "pure"
        },
        {
            name: "2. 連字號複合詞（姑姨，連字號延後切分測試）",
            input: "koo-î",
            expectedRhyme: "i",
            expectedTone: 5, // î 是第五調
            expectedVowel: "i",
            expectedType: "pure"
        },
        {
            name: "3. 聲母 j 殘留與第 7 聲測試（八字）",
            input: "peh-jī",
            expectedRhyme: "i",
            expectedTone: 7,
            expectedVowel: "i",
            expectedType: "pure"
        },
        {
            name: "4. 第 2 聲與複母音測試（草）",
            input: "tsháu",
            expectedRhyme: "au",
            expectedTone: 2,
            expectedVowel: "a", // 依你的複母音邏輯，au 取第一個 a
            expectedType: "pure"
        },
        {
            name: "5. 第 4 聲入聲字測試（食 tsia̍h 的本調，清洗後為 tsiah）",
            input: "tsiah",
            expectedRhyme: "iah",
            expectedTone: 4,
            expectedVowel: "a",
            expectedType: "checked"
        },
        {
            name: "6. 一世人 為鼻音韻尾",
            input: "lâng",
            expectedRhyme: "ang",
            expectedTone: 5,
            expectedVowel: "a",
            expectedType: "nasalCons"
        },
        {
            name: "7. 一刀兩斷 為鼻音韻尾",
            input: "it-to-lióng-tuān",
            expectedRhyme: "uan",
            expectedTone: 7,
            expectedVowel: "a",
            expectedType: "nasalCons"
        }
    ];

    let passCount = 0;

    testCases.forEach((c) => {
        try {
            const actual = parseLastTL(c.input);

            // 驗證比對
            const isRhymePass = actual.rhyme === c.expectedRhyme;
            const isTonePass = actual.tone === c.expectedTone;
            const isVowelPass = actual.mainVowel === c.expectedVowel;
            const isTypePass = actual.rType === c.expectedType;

            if (isRhymePass && isTonePass && isVowelPass && isTypePass) {
                console.log(`✅ ${c.name} --> 完美通過！`);
                passCount++;
            } else {
                console.group(`❌ ${c.name} --> 失敗了！`);
                console.log("輸入字串:", c.input);
                console.log("預期結果:", { rhyme: c.expectedRhyme, tone: c.expectedTone, mainVowel: c.expectedVowel, rType: c.expectedType });
                console.log("實際拿到:", actual);
                console.log(`詳細不符原因: 韻腳(${isRhymePass}) | 聲調(${isTonePass}) | 主音(${isVowelPass}) | 類型(${isTypePass})`);
                console.groupEnd();
            }
        } catch (error) {
            console.error(`💥 ${c.name} 執行時直接崩潰:`, error);
        }
    });

    console.log(`\n=== 📊 測試總結：共 ${testCases.length} 個測項，成功 ${passCount} 個 ===`);
    if (passCount === testCases.length) {
        console.log("🎉 超完美！系統已經具備神級防禦力，可以放心推進了！");
    } else {
        console.log("⚠️ 還有部分邊界狀況需要微調，看來魔王還沒完全死透。");
    }
}

// 執行測試
runSyllableSystemTest();