export const recoverySourcePath = "research/raw/research-redo-2026-08-23.md";

export const targetIds = [
  ...Array.from({ length: 106 }, (_, index) => index + 21)
    .filter((number) => number !== 103)
    .map((number) => `pc-${String(number).padStart(4, "0")}`),
  "pc-0147",
  "pc-0148",
];

const profiles = new Map();

function define(ids, profile) {
  for (const id of ids) {
    if (profiles.has(id)) throw new Error(`Duplicate research profile for ${id}`);
    profiles.set(id, profile);
  }
}

function low(ids, observation, question, sources = []) {
  define(ids, {
    confidence: "low",
    summary: `${observation} 本輪以截圖名稱、遊戲地點與可見物件重新查找，但尚未找到足以把它連到正式作品名、作者或沿革的可靠資料；因此只保留可驗證的畫面層資訊。`,
    facts: [observation],
    inferences: ["較像由玩家依外觀命名的在地 Wayspot；這是保守推論，不當作正式名稱來源。"],
    questions: [question],
    sources,
  });
}

define(["pc-0021"], {
  confidence: "low",
  summary: "截圖中的「騎海馬」是壽豐鄉鹽寮一帶一件兒童與海馬造型的戶外雕塑。重新比對後仍無法可靠確認設置單位、作者與正式作品名，暫不把它套到附近任何景點。",
  facts: ["截圖可見兒童攀附海馬的戶外立體造型。", "遊戲地點欄為 Yanliao Village, Shoufeng Township。"],
  inferences: ["Wayspot 名稱很可能是玩家依造型所取的描述名。"],
  questions: ["雕塑的精確位置、設置單位、作者與正式名稱為何？"],
  sources: [],
});

define(["pc-0022"], {
  confidence: "high",
  summary: "可定位為臺中市東勢區石城社區活動中心。國家文化記憶庫記錄：石城原為傳統竹編產地，社區在 2007 年推動竹藝營造，竹編師傅劉欽琳於 2008 年為活動中心製作多個竹編佈告欄。",
  facts: ["活動中心地址為臺中市東勢區石城街178號。", "竹編佈告欄源自2007年的竹藝社區營造，2008年由劉欽琳製作。"],
  inferences: ["明信片的研究價值不只在建物，而在活動中心保存的地方竹編產業與社區營造脈絡。"],
  questions: ["截圖正面可見的個別裝飾是否也是同一批社區竹藝工程的一部分？"],
  sources: ["https://tcmb.culture.tw/zh-tw/detail?id=614839&indexCode=Culture_Event"],
  location: { display: "臺中市東勢區石城里 石城街178號", city: "臺中市", district: "東勢區", locality: "石城里", latitude: 24.28559, longitude: 120.79232, normalization_confidence: "high" },
});

low(["pc-0023"], "截圖保存的是灣仔一處名為「紫荊廊」的 Wayspot，畫面為建物／招牌附近的局部景觀。", "它是否有正式英文名、營運單位或公共藝術登錄？");

define(["pc-0024"], {
  confidence: "medium-low",
  summary: "名稱與位置指向石川縣加賀市伊切町的八幡神社，可確認它是地方神社類 Wayspot；但本輪未找到神社本身的官方由緒頁，故不延伸祭神、創建年代或社格。",
  facts: ["遊戲名稱為伊切町八幡神社，地點欄為 Kaga, Ikirimachi。"],
  inferences: ["它應是服務伊切町聚落的地方八幡社。"],
  questions: ["神社的祭神、創建年代與歷次重建紀錄為何？"],
  sources: ["https://www.ishikawa-jinjacho.or.jp/"],
});

define(["pc-0025"], {
  confidence: "medium-high",
  summary: "可確認為高雄內門的「野森動物學校」。官方把場域定位為自然與動物體驗空間；旅遊介紹亦出現「狐狸谷」與「星月水籤所」，因此 Wayspot 的「星月水鐵所」很可能是舊名或誤植。",
  facts: ["野森動物學校位於高雄市內門區中正路39巷168號。", "場域介紹包含狐狸谷與星月水籤所。"],
  inferences: ["Wayspot 尾段「水鐵所」可能是「水籤所」的錯字或歷史命名殘留。"],
  questions: ["應以現場牌面或較高畫質截圖確認最後三字。"],
  sources: ["https://www.yessen.com.tw/", "https://www.niusnews.com/%3DP1al3a440"],
});

define(["pc-0026"], {
  confidence: "medium",
  summary: "東京迪士尼樂園西部樂園的「ELIAS HOTEL」是主題街景的一部分；遊園研究資料指出，這面旅館外觀實際藏有廁所，名稱 Elias 則呼應華特・迪士尼之父 Elias Disney。它的趣味在於用虛構旅館包裝實用設施。",
  facts: ["截圖地點欄為 Urayasu，名稱含東京ディズニーランド。", "遊園資料把 ELIAS HOTEL 外觀辨識為洗手間設施。"],
  inferences: ["Elias 的命名是迪士尼園區常見的家族史彩蛋。"],
  questions: ["園方是否有正式公開過此命名說明？"],
  sources: ["https://tokyodisneyresort.info/navi/archives/1076", "https://3kids-tdr.com/land_4/"],
});

low(["pc-0027"], "截圖中的「希臘風情城堡建築」是高雄阿蓮一棟白牆、藍色線腳、仿愛琴海語彙的建物。", "它的實際店家／建物名稱、設計者與用途為何？");

define(["pc-0028"], {
  confidence: "high",
  summary: "可確認為島根縣隱岐之島町的布施郵便局。日本郵政官方資料列址為布施 215-5；截圖保存的是偏遠島嶼聚落的日常公共服務地標，而非同名的其他布施郵局。",
  facts: ["日本郵政登錄名稱為布施郵便局。", "地址為島根県隠岐郡隠岐の島町布施215-5。"],
  inferences: ["同名郵局很多，遊戲地點欄與官方地址共同排除了其他縣市的布施郵便局。"],
  questions: [],
  sources: ["https://map.japanpost.jp/p/search/dtl/300153072000/"],
});

define(["pc-0029"], {
  confidence: "medium-low",
  summary: "地點可放在香港九龍灣德福花園／德福廣場範圍。港鐵資料確認德福花園建於九龍灣站上蓋、共 41 座；但「旋旋轉」這個具體遊樂或裝置物件仍無正式資料可對應。",
  facts: ["遊戲地點欄為 Telford Gardens, Kowloon Bay。", "港鐵資料列出德福花園共41座、分期於1980至1996年完成。"],
  inferences: ["名稱很可能由玩家依可旋轉的遊具或造型物取名。"],
  questions: ["物件位於住宅平台、商場還是公共遊樂場？是否仍存在？"],
  sources: ["https://www.mtr.com.hk/en/corporate/properties/ktl_kowloonbay.html"],
});

define(["pc-0030"], {
  confidence: "high",
  summary: "Taking Flight 是藝術家 Clifton Cox 於 2015 年完成的 13 英尺不鏽鋼雕塑，製作逾 600 小時；作品曾在肯塔基大學展出，2021 年透過 Snowy Range Rotating Sculpture Program 安裝於 Laramie。",
  facts: ["作者為Clifton Cox，作品完成於2015年。", "作品高13英尺，以不鏽鋼製作，2021-03-12安裝於Laramie。"],
  inferences: ["旋轉雕塑計畫讓作品的城市位置可能隨年度改變，研究時應保存當時位置。"],
  questions: ["2026年截圖時作品是否仍在2021年的原安裝點？"],
  sources: ["https://www.laramiepublicart.org/taking-flight", "https://www.cityoflaramie.org/1037/Public-Art"],
});

define(["pc-0031"], {
  confidence: "high",
  summary: "「蘇澳城隍爺沿革」對應蘇澳港城隍廟。國家文化記憶庫記錄其前身為日治時期臺泥蘇澳廠旁的萬應公廟，1938 年遷建、1953 年洪災後重建，1985 年再遷至現址並發展為城隍廟。",
  facts: ["廟史可追到日治時期臺泥蘇澳廠旁的萬應公廟。", "1953年洪災毀廟但神聖物保存，1985年遷至現址。"],
  inferences: ["Wayspot 拍的是沿革牌，價值在保存蘇澳工業、災害與民間信仰交疊的地方史。"],
  questions: [],
  sources: ["https://tcmb.culture.tw/zh-tw/detail?id=282429&indexCode=Culture_Place"],
});

define(["pc-0032"], {
  confidence: "low",
  summary: "韓文「쉼터」只表示休息處／休憩亭，並非唯一地名。截圖保存座標 36.676875, 127.393700，可用來定位忠清北道一帶，但沒有現場名稱或主管機關資料，故不把它命名成搜尋到的任何公園。",
  facts: ["截圖保存座標36.676875, 127.393700。", "쉼터在韓文中是泛稱的休息處。"],
  inferences: ["這可能是步道、社區或道路旁的遮蔭休憩設施。"],
  questions: ["座標對應的正式設施名稱與管理單位為何？"],
  sources: [],
  location: { display: "36.676875, 127.393700", latitude: 36.676875, longitude: 127.3937, normalization_confidence: "high" },
});

define(["pc-0033"], {
  confidence: "high",
  summary: "「騰雲駕霧」是柯濬彥 2016 年設置於淡水國民運動中心戶外走道的公共藝術，以不鏽鋼與霧氣營造輕盈、穿行雲霧的感受；新北市公共藝術資料另提供精確座標。",
  facts: ["作者為柯濬彥，設置年份為2016年。", "作品位於新北市淡水國民運動中心戶外走道。"],
  inferences: ["作品名稱與霧化／光影效果直接呼應，是可被官方資料完整還原的公共藝術。"],
  questions: [],
  sources: ["https://publicart.culture.ntpc.gov.tw/xcalbum/cont?sid=0G309507946767807350&xsmsid=0G287601173693314135"],
  location: { display: "新北市淡水區中山北路二段381巷2號", city: "新北市", district: "淡水區", latitude: 25.1876389, longitude: 121.4427778, normalization_confidence: "high" },
});

low(["pc-0034"], "截圖中的「小老虎 貓頭鷹」是北投桃源里一處仿樹幹上的貓頭鷹浮雕，旁邊可見兒童畫作。", "它屬於哪個校園、社區或公園？創作者與設置計畫為何？");
low(["pc-0035"], "截圖保存尖沙咀一處名為「Les Fleurs Du Mal」的 Wayspot。", "它究竟是店舖招牌、壁畫、雕塑或展覽物？是否取名自波特萊爾《惡之華》？");

define(["pc-0036"], {
  confidence: "medium-high",
  summary: "「時代大道」可定位到高雄前鎮夢時代商圈。高雄捷運官方資料確認輕軌夢時代站就在成功二路與時代大道路口；Wayspot 可能是道路景觀或路名設施，而非獨立藝術作品。",
  facts: ["夢時代輕軌站地址位於成功二路與時代大道路口。", "遊戲地點欄為高雄前鎮區興邦里。"],
  inferences: ["Wayspot 名稱較可能描述街道／入口景觀。"],
  questions: ["截圖中的具體物件是路牌、街景裝置或商場入口嗎？"],
  sources: ["https://www.krtc.com.tw/KLRT/station_map?id=9427796b1c254c7bab697a98ae316bf2"],
});

low(["pc-0037"], "截圖名稱為 Roller Park，地點落在法國 Maine-et-Loire 的 Orée-d’Anjou／Saint-Laurent-des-Autels。", "這是滑輪場、滑板場還是遊戲設施？正式法文名稱與管理單位為何？");

define(["pc-0038"], {
  confidence: "high",
  summary: "「守護與力量之鴿」是羅嘉惠 2024 年為臺北市警察局士林分局社子派出所創作的公共藝術。不鏽鋼鴿形象徵警察守護，設置於主要入口旁；作品尺寸約 600×375×380 公分。",
  facts: ["作者為羅嘉惠，設置年份2024年。", "材質為烤漆不鏽鋼，主題連結警察守護與和平意象。"],
  inferences: ["它把通常代表和平的鴿子重新詮釋成公共安全與力量的守護者。"],
  questions: ["官方頁面的地址欄與案件位置描述略有混雜，精確門牌應再以現場牌確認。"],
  sources: ["https://publicart.taipei/Works_detail.aspx?id=1207"],
});

low(["pc-0039"], "截圖保存宜蘭冬山群英里、純精路附近一處「昭靈宮」相關 Wayspot。", "廟宇正式名稱、主祀神明與沿革是否有地方志或寺廟登記可查？");
low(["pc-0040"], "「龍騰」位於臺北市中山區中原里；截圖名稱不足以區分它是雕塑、壁畫或建築裝飾。", "物件外觀、作者與設置場域為何？");

define(["pc-0041"], {
  confidence: "medium-high",
  summary: "可定位到臺北市林安泰古厝民俗文物館園區。林安泰古厝建於清代、後遷建保存，園內以傳統宅院與庭園構成；截圖的石橋是園景構件，但未找到橋本身的獨立正式名稱。",
  facts: ["林安泰古厝是臺北市公開參觀的歷史宅院與民俗文物館。", "截圖地點欄落在中山區新庄里，與園區位置相符。"],
  inferences: ["Wayspot 名稱是以園內材質與功能描述石橋，而非官方登錄的作品名。"],
  questions: ["該橋在園方配置圖上的正式稱呼為何？"],
  sources: ["https://www.travel.taipei/en/attraction/details/508"],
});

low(["pc-0042"], "「Wild West (Social) Justice」是懷俄明州 Laramie 市中心的一幅壁畫，但 Laramie 公共藝術目錄未找到同名作品頁。", "壁畫的作者、年份、牆址與完整主題敘述為何？", ["https://www.laramiepublicart.org/", "https://www.cityoflaramie.org/1037/Public-Art"]);
low(["pc-0043"], "「To gather together」位於加拿大維多利亞市 Chinatown；精確搜尋仍未可靠對上正式作品登錄。", "作品媒材、作者、原住民／華埠脈絡與設置位置為何？");

define(["pc-0044"], {
  confidence: "high",
  summary: "舊油麻地警署於 1922／1923 年前後落成，是九龍現存最早期的警署之一，主樓以兩翼組成罕見 V 字形並帶新古典／愛德華時期建築語彙，2009 年列為二級歷史建築，也長期成為香港警匪片取景地標。",
  facts: ["警署現址為廣東道627號。", "建物為二級歷史建築，主樓具有V字形平面與古典建築元素。"],
  inferences: ["其收藏價值兼具城市發展、警政史、建築史與香港電影文化。"],
  questions: ["官方資料有1922年遷入與1923年竣工兩種表述，宜保留兩者的事件差異。"],
  sources: ["https://www.aab.gov.hk/filemanager/aab/common/180meeting/aab_21_2017-18-a-tc.pdf", "https://www.police.gov.hk/offbeat/1215/chi/9026.html"],
});

low(["pc-0045"], "截圖中的「公園涼亭」位於臺北市北投區稻香里，是常見的公園遮蔭休憩設施。", "它位於哪一座公園，是否有正式亭名或建造年份？");

define(["pc-0046"], {
  confidence: "high",
  summary: "「きしべの路」是世田谷區沿國分寺崖線規劃、由成城學園前延伸到二子玉川的約 8.7 公里散步路線，串聯湧水、綠地、歷史與舊砧線遺構；截圖副名指出二子玉川櫸木綠地段。",
  facts: ["世田谷區官方把路線長度列為約8.7公里。", "路線從成城學園前通往二子玉川並沿國分寺崖線。"],
  inferences: ["Wayspot 指向的是線性步道中的一段，而非單一建物。"],
  questions: [],
  sources: ["https://www.city.setagaya.lg.jp/02074/4693.html"],
});

low(["pc-0047"], "「蜂巢廊亭」是深圳一處蜂巢幾何語彙的廊亭／遮蔭構築物。", "位於哪個社區或公園？設計團隊與設置年份為何？");
low(["pc-0048"], "名稱把物件定位成法國 Nantes 的 rue Jean Jaurès 某棟立面，但沒有門牌，搜尋結果無法排除同街其他建物。", "精確門牌、建築年代、建築師與立面保護狀態為何？");

define(["pc-0049"], {
  confidence: "low",
  summary: "「山縣孝亮先生像」位於東京日本橋三丁目。公開資料能找到同名人物與工學院、機械製作業的零散關聯，但沒有來源把該人物、雕像與現址完整串起，故暫不認定身分。",
  facts: ["截圖明確顯示名稱為山縣孝亮先生像、地點為日本橋三丁目。"],
  inferences: ["可能紀念近代工業／工程界人物，但目前證據鏈不足。"],
  questions: ["銘牌全文、設置機構、雕像作者與被紀念者生平為何？"],
  sources: [],
});

low(["pc-0050"], "Gym Equipment 位於澳洲新南威爾斯 Albion Park Rail，截圖只足以確認戶外健身器材類 Wayspot。", "它位於哪一座公園或步道？地方政府的設施名稱與座標為何？");

define(["pc-0051"], {
  confidence: "medium-high",
  summary: "可確認為三軒茶屋的濱田家（濱田屋）麵包店；地方店家資料稱其 2000 年開業，以日本食材與和風麵包為特色。Wayspot 保存的是在地商店招牌／外觀，而非同名旅館或料亭。",
  facts: ["店址位於東京都世田谷區三軒茶屋2丁目。", "店家資料記錄三軒茶屋本店於2000年開業。"],
  inferences: ["日文店名寫法在「濱田家／濱田屋」間可能因招牌、資料庫轉寫而異。"],
  questions: ["截圖牌面實際使用哪一個漢字寫法？"],
  sources: ["https://www.setagaya-navi.com/gourmet/hamadaya/", "https://tabelog.com/tokyo/A1317/A131706/13005398/"],
});

low(["pc-0052"], "「世田谷コーポの小さな祠」是太子堂二丁目集合住宅旁的小型祠物，截圖未見可讀銘文。", "供奉對象、管理者與是否為原地舊祠或後設裝飾？");

define(["pc-0053"], {
  confidence: "medium-high",
  summary: "新大久保站高架下壁畫於 2022 年完成：商店街資料指出南側由高岡洋介、北側由横島基尚繪製。截圖地點是百人町二丁目，較可能屬北側作品，但仍應用牆面構圖確認。",
  facts: ["南側壁畫於2022-05-25完成，北側於2022-06-04完成。", "官方商店街頁分別列出高岡洋介與横島基尚。"],
  inferences: ["百人町二丁目線索使北側／横島基尚成為較強候選，但不是僅靠地址即可定論。"],
  questions: ["以原圖牆面與官方作品照比對，確認是南側或北側。"],
  sources: ["https://shin-ookubo.or.jp/painting"],
});

define(["pc-0054"], {
  confidence: "high",
  summary: "遠企中心是臺北敦化南路的辦公、飯店與商場複合開發，由李祖原聯合建築師事務所設計；雙塔量體約 42／43 層，將香格里拉飯店、辦公與零售機能整合在同一基地。",
  facts: ["建築設計由李祖原聯合建築師事務所負責。", "開發整合飯店、商場與辦公空間。"],
  inferences: ["Wayspot 名稱聚焦辦公大樓，但明信片其實記錄的是整體遠企複合城的雙塔地標。"],
  questions: ["不同承建／建築資料對樓層計法有42與43層差異。"],
  sources: ["https://www.onenessarchitects.com/project/Far-Eastern-Plaza-Hotel-Taipei?lang=tw", "https://www.dacin.com.tw/project/inner.php?index_id=31&index_m_id=34"],
});

low(["pc-0055"], "「火車輪椅椅」截圖顯示一件帶火車意象的座椅／遊具，地點欄為中正區黎明里。", "它位於臺北車站周邊哪個空間，正式名稱與設置單位為何？");
low(["pc-0056"], "「都市百合」位於北投八仙里，截圖名稱像公共藝術或社區美化作品，但臺北公共藝術資料未找到可確定的同名項目。", "作品媒材、作者、地址與設置年份為何？");

define(["pc-0057"], {
  confidence: "medium-low",
  summary: "地點與名稱指向菲律賓 Cavite 的 Lumina General Trias 住宅開發，物件是社區供水設施／水塔。可確認開發案存在，但未找到水塔本身的工程資料或正式名稱。",
  facts: ["遊戲地點欄為 San Francisco, General Trias。", "Lumina General Trias 是當地住宅開發名稱。"],
  inferences: ["水塔因體量與辨識度成為社區地標，但不代表對外開放景點。"],
  questions: ["水塔的管理者、容量、啟用年份與精確座標為何？"],
  sources: [],
});

define(["pc-0058"], {
  confidence: "high",
  summary: "可確認為瑞典 Linköping 的 Ryd 戶外健身場。市政府把 Utegymmet i Ryd 列為無障礙戶外訓練設施，並與 Ryd 運動中心的跑道、活動空間共同管理。",
  facts: ["Linköping市政府正式列出Utegymmet i Ryd。", "該戶外健身場被列在可及性調整的運動設施中。"],
  inferences: ["Wayspot 的英文名是瑞典設施名 Utegymmet i Ryd 的直譯。"],
  questions: [],
  sources: ["https://www.linkoping.se/uppleva-och-gora/idrott-motion-och-bad/arenor-och-idrottsanlaggningar/tillganglig-utomhustraning"],
});

low(["pc-0059"], "「Post Owl」位於東京目黑本町五丁目，截圖中的具體貓頭鷹郵務／招牌物件沒有查到正式作品登錄。", "它是否附著於郵筒、店家、住宅或社區告示設施？");

define(["pc-0060"], {
  confidence: "medium-low",
  summary: "名稱與遊戲地點共同指向福井縣越前町米ノ的惠比壽神社；「米ノ裏」可能是聚落內方位或 Wayspot 命名補充。未找到神社本身的可靠由緒頁，因此不推定創建年代或祭典。",
  facts: ["遊戲名稱為米ノ裏 恵比寿神社，地點欄為 Echizen, Komeno。"],
  inferences: ["惠比壽信仰與沿海聚落的漁業脈絡可能相關，但此處尚無直接來源證成。"],
  questions: ["神社正式登錄名稱、祭神、例祭與漁村關係為何？"],
  sources: [],
});

define(["pc-0061", "pc-0076"], {
  confidence: "high",
  summary: "兩張獨立截圖都指向澳洲新南威爾斯 Morton National Park 的入口／歡迎牌。NSW National Parks 將其描述為具有峽谷、雨林與瀑布的大型國家公園，Bundanoon 是主要進入區域之一。",
  facts: ["Morton National Park由NSW National Parks管理。", "Bundanoon是官方列出的公園進入區域。"],
  inferences: ["相同 Wayspot、日期與地點但不同圖片，應保留成兩張 postcard 並維持既有關聯。"],
  questions: ["兩張照片是否拍到同一塊入口牌的不同遊戲構圖？"],
  sources: ["https://www.nationalparks.nsw.gov.au/visit-a-park/parks/morton-national-park"],
});

define(["pc-0062"], {
  confidence: "medium",
  summary: "可確認成田機場曾與 Pokémon 合作設置大型歡迎壁畫與展示。官方 2023 新聞稿記錄第二航廈抵達大廳的歡迎壁畫，但原計畫展期到 2025 年；這張 2026 截圖可能是另一航廈、續展或不同版本，不能直接視為同一件。",
  facts: ["成田機場官方曾公布第二航廈Pokémon歡迎壁畫。", "明信片地點欄為成田市三里塚御料，符合機場範圍。"],
  inferences: ["Wayspot 名稱泛稱 Pokemon Mural，可能保存一個展期已變動的機場展示。"],
  questions: ["以照片角色配置比對航廈、版本與2026年現況。"],
  sources: ["https://www.narita-airport.jp/files/2a9a346309f38d8bc2d8547d26af224af9e9b0bac44cfc0f3f020a29d4143095"],
});

define(["pc-0063"], {
  confidence: "high",
  summary: "Corbett Gardens 是 Bowral 市中心的老牌公園，也是年度 Tulip Time 的核心場地。Wingecarribee Shire Council 記錄花季會種植超過 75,000 株鬱金香與 15,000 株一年生花卉。",
  facts: ["Corbett Gardens位於Bowral市中心。", "公園是Tulip Time活動核心場地。"],
  inferences: ["明信片的地方代表性高，因它連結Bowral最具辨識度的季節花卉活動。"],
  questions: [],
  sources: ["https://www.wsc.nsw.gov.au/Places/Facilities/Parks/corbett-gardens-bowral"],
  location: { display: "Corbett Gardens, Bowral, New South Wales", city: "Bowral", region: "New South Wales", latitude: -34.4785248, longitude: 150.4201151, normalization_confidence: "high" },
});

low(["pc-0064"], "「烈日下的觀塘壁畫」是香港觀塘一幅戶外壁畫，名稱明顯是玩家描述性命名。", "壁畫牆址、作者、繪製計畫與是否仍存為何？");
low(["pc-0065"], "「拾貝美術館」位於臺北市中正區愛國里，但沒有查到同名正式館舍；截圖可能是小型展示、店家或玩家命名的裝置。", "現場招牌全名、地址、營運單位與展覽內容為何？");

define(["pc-0066"], {
  confidence: "medium-high",
  summary: "「One Grantai Fontain」對應澳門氹仔住宅項目 One Grantai 的入口水景；P&T 建築資料確認該項目由六座 32／34 層住宅塔樓、平台花園與會所構成，2005–2011 年完成。Wayspot 的 Fontain 應是 Fountain 拼字誤植。",
  facts: ["One Grantai位於Macau SAR，項目由六座住宅塔樓組成。", "P&T列出的項目期為2005至2011年。"],
  inferences: ["明信片標題的Fontain很可能是Wayspot舊拼字錯誤。"],
  questions: ["水景是否有獨立設計名、作者與落成年份？"],
  sources: ["https://web.p-t-group.com/en/project-detail.php?projects_category_id=3&projects_id=173", "https://www.ambiente.mo/building/one-grantai/"],
});

define(["pc-0067"], {
  confidence: "high",
  summary: "可確認為東大阪市上石切町二丁目「上石切天空の街公園」。市政府設施頁列出健康器具與足底刺激步道，說明它是住宅坡地中的社區公園而非商業景點。",
  facts: ["正式名稱為上石切天空の街公園。", "東大阪市資料列有健康器具與足底刺激設施。"],
  inferences: ["遊戲名稱省略「上石切」，仍可由地點與官方名稱可靠對應。"],
  questions: [],
  sources: ["https://www.city.higashiosaka.lg.jp/0000029499.html"],
});

define(["pc-0068"], {
  confidence: "high",
  summary: "此慰靈碑紀念 1971 年 11 月 14 日澀谷暴動中殉職的警察官。警察白書確認事件中警察官遭燃燒瓶攻擊身亡，並促成日本 1972 年施行燃燒瓶管制法；碑本身的位置變遷則需與事件史分開看待。",
  facts: ["澀谷暴動發生於1971-11-14。", "事件後日本於1972-05-14施行燃燒瓶使用等處罰法。"],
  inferences: ["這是一個政治記憶高度敏感的地標，研究應明確區分官方事件紀錄與碑的後來設置／遷移。"],
  questions: ["碑最初設置時間、歷次遷移與現址管理單位為何？"],
  sources: ["https://www.npa.go.jp/hakusyo/s48/s480700.html"],
});

low(["pc-0069"], "「水盆」位於臺北北投一德里；截圖僅能辨認一件盆狀水景／器物。", "它位於公園、寺廟、住宅或公共建築？是否有銘牌與正式名稱？");
low(["pc-0070"], "截圖指向花蓮市民德里、環保局生態滯洪池旁的一座橋，名稱已提供相對位置但非正式橋名。", "滯洪池與橋的工程名稱、完工年份、生態功能及管理單位為何？");
low(["pc-0071"], "「Metal Objects」位於東京惠比壽一丁目，截圖名稱過於泛化，無法從公開資料唯一識別。", "物件是公共藝術、街具、建物裝飾或臨時展示？");

define(["pc-0072"], {
  confidence: "high",
  summary: "舊新橋停車場鐵道歷史展示室位於日本第一條鐵路的起點遺址範圍，以史料重建明治期車站外觀，館內免費展示汐留地區與日本鐵路近代化歷史，現場亦可見原站舍基礎遺構。",
  facts: ["1872年日本首條鐵路由新橋至橫濱開業。", "現建物依史料重建，展示室免費開放並保存基礎遺構。"],
  inferences: ["這張卡兼具建築復原與交通史現地性的高研究價值。"],
  questions: [],
  sources: ["https://www.ejrcf.or.jp/shinbashi/", "https://www.city.minato.tokyo.jp/documents/125393/mc21wi_web.pdf"],
});

define(["pc-0073"], {
  confidence: "medium-high",
  summary: "廟街因油麻地天后廟而得名；現今街道兩端的中式牌坊於 2010 年揭幕，強化夜市入口辨識。明信片的「廟街牌坊」因此同時是觀光入口、夜市視覺識別與廟街歷史地名的節點。",
  facts: ["廟街名稱與區內天后廟相關。", "兩座琉璃瓦牌坊於2010-12-18揭幕。"],
  inferences: ["牌坊本身較新，但承接的是更早的廟街與夜市城市記憶。"],
  questions: ["截圖拍到佐敦端或油麻地端牌坊？"],
  sources: ["https://hk.history.museum/documents/54401/54576/2_J_2.pdf", "https://temples.tungwahcsd.org/media-coverage/detail?_fsize=s&_lang=en&id=1400"],
});

low(["pc-0074"], "「マニ車」位於世田谷上馬四丁目，畫面名稱指向藏傳佛教轉經輪，但沒有證據確認場域、年代或宗教機構。", "它位於寺院、店家或私人設施？轉經輪上的文字與設置者為何？");

define(["pc-0075"], {
  confidence: "medium-low",
  summary: "可確認世田谷上馬三丁目有曹洞宗宗圓寺，東京都宗教法人名簿亦列出其地址；但明信片的「石標」是道路旁界標或寺名標石，未查到單獨沿革。",
  facts: ["東京都宗教法人名簿列宗圓寺為曹洞宗寺院，地址上馬3-6-8。"],
  inferences: ["石標可能用來指示寺域或舊參道，而非獨立紀念碑。"],
  questions: ["石標刻文、年代與原位置是否可由高畫質照片讀取？"],
  sources: ["https://www.seikatubunka.metro.tokyo.lg.jp/documents/d/seikatubunka/houjinmeibo_20241231-pdf"],
});

define(["pc-0077"], {
  confidence: "medium-low",
  summary: "挪威語 grusbane 指碎石／砂礫球場，Skulstad Grusbane 應是 Bergen 的 Arna／Trengereid 一帶社區運動場。精確搜尋沒有找到市府設施頁，故不補球種、尺寸或管理者。",
  facts: ["遊戲名稱為Skulstad Grusbane，地點欄為Arna, Trengereid。"],
  inferences: ["這類場地多服務在地足球或多用途球類活動。"],
  questions: ["正式地址、場地主體與目前鋪面狀態為何？"],
  sources: [],
});

define(["pc-0078"], {
  confidence: "high",
  summary: "這是生駒市新設計彩色人孔蓋的第一號，市府記錄它設於生駒站南側巴士站附近，且彩色版本僅此一枚；因此不只是一般人孔蓋，而是城市下水道設計的示範點。",
  facts: ["生駒市於2018-05-30公告完成新設計第1號彩色人孔蓋。", "設置點在生駒站南側巴士站附近，彩色版本僅一枚。"],
  inferences: ["Wayspot 名稱雖泛稱生駒市彩色人孔蓋，實際具有首件與唯一彩色版的稀有性。"],
  questions: [],
  sources: ["https://www.city.ikoma.lg.jp/0000012751.html"],
});

define(["pc-0079"], {
  confidence: "high",
  summary: "Wayspot 的 Rivelut 應是 Rivulet 拼字錯誤。Wingecarribee Shire Council 確認 Bowral 的 Rivulet Park 位於 Victoria Street、具步行空間；戶外健身資料亦指向同一公園。",
  facts: ["正式公園名為Rivulet Park。", "市府座標為-34.475459, 150.4220084。"],
  inferences: ["明信片是保存拼字錯誤 Wayspot 的又一個 Niantic 地標考古案例。"],
  questions: ["戶外健身器材的設置年份與設備清單為何？"],
  sources: ["https://www.wsc.nsw.gov.au/Places/Facilities/Parks/rivulet-park-bowral", "https://freeoutdoorfitness.net/listing/rivelut-park-outdoor-gym/"],
  location: { display: "Rivulet Park, Bowral, New South Wales", city: "Bowral", region: "New South Wales", latitude: -34.475459, longitude: 150.4220084, normalization_confidence: "high" },
});

define(["pc-0080", "pc-0081"], {
  confidence: "medium-low",
  summary: "兩張獨立截圖都指向西麻布三丁目同一處「鬼子母神堂」。地方散步資料提到西麻布確有鬼子母神堂，江戶時期逢帶 8 的日子曾有緣日；但它不是著名的雜司谷鬼子母神堂，兩者不可混用。",
  facts: ["遊戲地點欄為Minato, Nishiazabu 3-Chōme。", "兩張卡的名稱、日期與地點相同但圖片checksum不同。"],
  inferences: ["這是地方小堂，網路資料稀少；同名搜尋極易被雜司谷結果淹沒。"],
  questions: ["堂的宗派／管理寺院、建造年代與祭祀活動為何？"],
  sources: ["https://tokyosaihakken.blog50.fc2.com/blog-entry-71.html"],
});

define(["pc-0082"], {
  confidence: "high",
  summary: "標題的「35B10000型石渣車」對應臺鐵道碴車。潮州鐵道園區資料記錄臺鐵於 2000 年向唐榮購入 25 輛，展車為 35B10016，漏斗車體可將石碴投放到軌道以維護道床。",
  facts: ["臺鐵於2000年購入25輛此型石碴車。", "潮州鐵道園區展示車號為35B10016。"],
  inferences: ["Wayspot 名稱用系列名，園區資料可進一步精確到展示車號。"],
  questions: [],
  sources: ["https://www.chaozhourailwaypark.com.tw/train/2/"],
});

define(["pc-0083"], {
  confidence: "high",
  summary: "顏水龍《從農業社會到工業社會》於 1969 年設於劍潭公園，被文化部資料稱為臺灣第一件公共藝術。大型馬賽克以多個場景描繪臺灣由農業走向工業的社會轉型。",
  facts: ["作者為顏水龍，作品完成於1969年。", "文化部資料稱其為臺灣第一件公共藝術。"],
  inferences: ["它既是美術作品，也是戰後現代化敘事如何進入公共空間的重要史料。"],
  questions: ["作品歷次修復的材料替換與原作保存比例可再深化。"],
  sources: ["https://www.moc.gov.tw/en/News_Content2.aspx?n=483&s=17537", "https://taipeiartweek.tw/zh/listing/%E5%BE%9E%E8%BE%B2%E6%A5%AD%E7%A4%BE%E6%9C%83%E5%88%B0%E5%B7%A5%E6%A5%AD%E7%A4%BE%E6%9C%83/"],
});

define(["pc-0084"], {
  confidence: "low",
  summary: "截圖可見一座小型仿岩人工瀑布，遊戲只標 Seoul。首爾官方資料顯示市內有多處人工瀑布，僅靠這張低畫質局部圖不足以判定是鷺梁津公園或其他場址。",
  facts: ["截圖物件是帶植栽的小型人工岩壁瀑布。", "遊戲地點欄只到Seoul，沒有區名。"],
  inferences: ["搜尋到的鷺梁津公園只是候選之一，不應寫成已定位。"],
  questions: ["需要更廣的地圖畫面、韓文副標或高畫質照片才能鎖定公園。"],
  sources: ["https://parks.seoul.go.kr/parks/detailView.do?pIdx=57&tabTarget=1", "https://mediahub.seoul.go.kr/archives/2014868"],
});

define(["pc-0085"], {
  confidence: "medium",
  summary: "可定位為北投洲美地區的蜆仔港公園；「涼亭」是園內休憩設施的描述名。公開資料把此處列為洲美蜆仔港公園，但亭體本身沒有查到獨立命名或設計資料。",
  facts: ["遊戲地點欄為臺北市北投區建民里。", "蜆仔港公園是洲美地區公園名稱。"],
  inferences: ["Wayspot 名稱是公園名加設施類型，並非獨立作品名。"],
  questions: ["涼亭的設置年份、整建紀錄與精確園區位置為何？"],
  sources: [],
});

define(["pc-0086"], {
  confidence: "low",
  summary: "原圖顯示臺北內湖一面帶英文字樣「NeiHu B and Q」的彩繪／廣告式牆面，夕景與高樓可能是圖像構成而非實際景觀。精確字串搜尋沒有找到可靠場域資料。",
  facts: ["截圖地點欄為Huyuan, Neihu District。", "畫面上的NeiHu B and Q是可讀文字的一部分。"],
  inferences: ["B and Q 可能是店名、社區縮寫或玩家自行解讀，現階段無法展開。"],
  questions: ["需要較高畫質原圖讀取牆面其他文字、logo與門牌。"],
  sources: [],
});

define(["pc-0087"], {
  confidence: "medium",
  summary: "St.PAX CAFE 是三軒茶屋一丁目一間以音樂／DJ 活動為特色的小型咖啡酒吧；店家仍有自營網站。Wayspot 保存的是地方獨立店面，而不是連鎖品牌。",
  facts: ["店名與遊戲地點皆指向三軒茶屋。", "店家網站以St.PAX CAFE名義發布活動資訊。"],
  inferences: ["地方店家的營業狀態可能變動，明信片同時具備時間切片價值。"],
  questions: ["截圖拍攝時的招牌是否仍與目前店面一致？"],
  sources: ["https://stpaxcafe.fc2.net/"],
});

low(["pc-0088"], "截圖中的「巨嬰」是北投長安里鐵捲門上的大型嬰兒壁畫，嬰兒正握著／咬著手指。", "壁畫的店址、作者、創作年份與題名為何？");

define(["pc-0089"], {
  confidence: "high",
  summary: "藤城清治美術館位於那須高原，專門展示藤城清治長達八十餘年的光影／影繪創作。館舍與庭園共同營造作品中的光、色與童話性，是一座明確以單一藝術家為核心的美術館。",
  facts: ["館舍位於栃木縣那須町湯本。", "官方把常設收藏定位為藤城清治八十餘年光影創作的集成。"],
  inferences: ["明信片的地點代表性與藝術家脈絡都很完整。"],
  questions: [],
  sources: ["https://fujishiro-seiji-museum.jp/", "https://fujishiro-seiji-museum.jp/pages/100"],
});

low(["pc-0090"], "「石板藝術圍牆」位於臺北市大安區華聲里，截圖顯示的應是以石板／浮雕構成的圍牆美化。", "牆址、作者、社區建案與圖像主題為何？");
low(["pc-0091"], "「中國刺繡」位於花蓮市國聯里，名稱可能描述一件刺繡圖像、展示櫃或牆面裝飾。", "它隸屬哪個場館／店家，作品年代、地區技法與作者為何？");

define(["pc-0092", "pc-0096"], {
  confidence: "medium",
  summary: "兩張獨立截圖指向板橋莊敬里「農會亭」。地方公園資料把農會亭列在石雕公園／農村公園周邊的中式亭廊設施中；目前缺少市府針對亭體的獨立沿革。",
  facts: ["兩張卡名稱、日期與地點相同但圖片checksum不同。", "農會亭是板橋當地公園設施名稱。"],
  inferences: ["名稱可能反映附近農會或農村公園脈絡，而不是一般泛稱涼亭。"],
  questions: ["亭的正式管理公園、落成年份與命名來源為何？"],
  sources: ["https://zh.wikipedia.org/wiki/%E7%9F%B3%E9%9B%95%E5%85%AC%E5%9C%92"],
});

define(["pc-0093", "pc-0097"], {
  confidence: "medium-low",
  summary: "兩張獨立截圖都記錄瑞典 Färjestaden 的 Ullevi 資訊牌。Ullevi 在此是當地街區／道路名稱；附近亦有舊里程碑資料，但無法只靠標題確認資訊牌講的就是里程碑。",
  facts: ["遊戲地點欄為Ullevi, Färjestaden。", "兩張卡名稱、日期與地點相同但圖片不同。"],
  inferences: ["搜尋中其他省份的Ullevi岩刻屬同名噪音，不能移植到這張卡。"],
  questions: ["資訊牌的瑞典文全文與主題為何？"],
  sources: ["https://www.mingata.se/F%C3%A4rjestaden/Ullevi/", "https://alltpaoland.se/platser/milsten-vid-ullevi/"],
});

low(["pc-0094"], "「行人天橋底下的壁畫」位於香港銅鑼灣，標題同時保留了中英文描述。", "是哪座天橋、壁畫作者、主題與城市美化計畫為何？");

define(["pc-0095"], {
  confidence: "medium",
  summary: "標題「M4843」很可能是 M48A3 的字元黏連；內湖國防醫學院一帶確有 M48A3 戰車展示的記錄。這個型號修正仍屬強推論，應以車體銘牌或高畫質標題確認。",
  facts: ["遊戲地點欄為臺北市內湖區寶湖里。", "公開照片／記錄指向國防醫學院展示M48A3戰車。"],
  inferences: ["M4843應為M48A3的OCR或Wayspot輸入錯誤。"],
  questions: ["展示車的序號、服役史、設置年份與標牌全文為何？"],
  sources: ["https://lordcat.net/archives/2663", "https://indsr.org.tw/respublicationcon?pid=2663&resid=714&uid=12"],
});

define(["pc-0098"], {
  confidence: "high",
  summary: "楊屋道郵政局位於荃灣楊屋道 138 號樂悠居 1 樓 15 號舖。香港政府 2008 年公告它取代因大樓狀況而關閉的德士古道郵政局，因此這個 Wayspot 也保存了一次地區郵政服務遷址。",
  facts: ["楊屋道郵政局地址為荃灣楊屋道138號樂悠居1樓15號舖。", "郵局於2008年取代德士古道郵政局。"],
  inferences: ["它是日常公共服務地標，同時具備可查證的遷址歷史。"],
  questions: [],
  sources: ["https://www.info.gov.hk/gia/general/200804/14/P200804140181.htm", "https://www.districtcouncils.gov.hk/archive/tw_d/pdf/2009/TW_09-10_23_TC.pdf"],
});

define(["pc-0099"], {
  confidence: "high",
  summary: "可確認為臺北市北投區光明路一帶的光明橋。臺北市橋涵管理系統將其列為跨河橋梁 G169，並提供橋長、寬度與座標，可排除其他城市同名橋。",
  facts: ["臺北市橋涵系統編號為G169。", "橋位於北投區光明路157巷2弄附近，系統提供端點座標。"],
  inferences: ["同名橋很多，官方橋梁編號與北投地點是本筆定位關鍵。"],
  questions: [],
  sources: ["https://bridge.nco.taipei/bms2/guest/bridge/inventory.aspx?vid=28842"],
  location: { display: "臺北市北投區光明路157巷2弄 光明橋", city: "臺北市", district: "北投區", latitude: 25.13571, longitude: 121.502532, normalization_confidence: "high" },
});

low(["pc-0100"], "「木製品之精彩演譯」位於桃園大園埔心里，名稱可能把「演繹」誤寫成「演譯」，畫面對應木作展示或裝置。", "展示場域、作者、作品原名與標題是否確有錯字？");
low(["pc-0101"], "「山水電箱」位於北投中央里，應是把配電／電信箱彩繪成山水景觀的街道美化物。", "彩繪計畫、作者、完成年份與箱體管理單位為何？");

define(["pc-0102", "pc-0110"], {
  confidence: "medium-low",
  summary: "兩張獨立截圖記錄敦賀市沓見的「下風呂山公園」。市府資料可確認沓見地區有公園與運動設施，但沒有找到這個小公園的獨立沿革頁，因此暫只做到地區級定位。",
  facts: ["兩張卡名稱、日期與地點相同但圖片checksum不同。", "遊戲地點欄為Tsuruga, Kutsumi。"],
  inferences: ["括號中的下風呂山可能是地方小字、山名或公園別稱。"],
  questions: ["正式公園台帳名稱、邊界、設施與開設年份為何？"],
  sources: ["https://www.city.tsuruga.lg.jp/"],
});

define(["pc-0104", "pc-0126"], {
  confidence: "high",
  summary: "田舎館村埋藏文化財中心以垂柳遺址與高樋遺址的彌生時代稻作遺構為核心，館內可走入約 2,100 年前水田與水路的保存展示；村方近年更新展示並與弘前大學共同研究。",
  facts: ["館內保存展示約2100年前的水田與水路遺構。", "展示包含炭化米、土器與石斧等出土資料。"],
  inferences: ["它把青森田園景觀連回日本北方早期稻作史，研究價值遠高於一般地方展示館。"],
  questions: ["兩張截圖是否為同一遊戲畫面的不同原始圖片版本？"],
  sources: ["https://www.hirosaki-kanko.or.jp/details.html?id=API00300000329", "https://www.vill.inakadate.lg.jp/docs/2025040300017/files/202505.pdf"],
});

low(["pc-0105", "pc-0125"], "「羊マット」是東京惠比壽西一丁目一塊帶羊圖像的門墊／地面裝飾，兩張獨立截圖保存同一 Wayspot。", "它屬於哪間店家或建物？羊圖案是否為品牌識別？");
low(["pc-0106", "pc-0124"], "「シーサー@上馬3」是世田谷上馬三丁目一對／一件沖繩風獅像，兩張獨立截圖保存同一 Wayspot。", "獅像的地址、製作者、設置年代及是否由沖繩工房製作？");

define(["pc-0107", "pc-0123"], {
  confidence: "high",
  summary: "可確認為臺北北投大同街 15 號的 Slipper Cafe／拖鞋咖啡。臺北市動物友善空間名冊列出店名、電話與地址，並標示提供飲水與寵物餐點；兩張卡是同一店家的獨立截圖。",
  facts: ["臺北市名冊列地址為北投區大同街15號。", "店家被列為動物友善空間。"],
  inferences: ["中英文店名並存，Wayspot 使用中文「拖鞋咖啡」。"],
  questions: ["店面與招牌是否仍維持截圖時狀態？"],
  sources: ["https://www-ws.gov.taipei/Download.ashx?u=LzAwMS9VcGxvYWQvNjg0L3JlbGZpbGUvNDU4ODkvOTUzMzYxNS8wNjliMjM0Ny0zODdmLTQ1YjAtYjkwNC02YjQ4ZGM1ZjU0OTgucGRm&n=6Ie65YyX5biC5YuV54mp5Y%2BL5ZaE56m66ZaT5ZCN5YaKLnBkZg%3D%3D&icon=.pdf", "https://www.eaters.tw/place/cafe/taipei/517"],
  location: { display: "臺北市北投區大同街15號", city: "臺北市", district: "北投區", normalization_confidence: "high" },
});

define(["pc-0108", "pc-0122"], {
  confidence: "high",
  summary: "兩張卡記錄基隆河河濱自行車道的導覽圖。交通部自行車入口網將路線列為基隆河左右岸自行車道，跨越中山、內湖、士林與北投；明信片地點在北投八仙里，屬這條線性系統的一個節點。",
  facts: ["官方路線名稱為Keelung River Left And Right Banks Bikeway。", "路線跨越臺北多個行政區並沿基隆河兩岸。"],
  inferences: ["Wayspot 是路線導覽設施，地圖應用地點級 query，而非假設整條路線只有一個座標。"],
  questions: ["導覽牌位於哪個河濱出入口或橋下節點？"],
  sources: ["https://taiwanbike.tw/en/bikeRoute/search/22020100001000", "https://travel.taipei/en/must-visit/riverside-bikeway"],
});

define(["pc-0109", "pc-0121"], {
  confidence: "high",
  summary: "駒沢ガーデンハウス是世田谷駒沢一丁目 2-33 的低層大型住宅，1989 年竣工、共 57 戶，由多棟 7／8 層建物組成。截圖拍的是入口刻字景觀，兩張卡保留同一住宅地標的不同遊戲畫面。",
  facts: ["地址為東京都世田谷区駒沢1丁目2-33。", "建物於1989年竣工，共57戶。"],
  inferences: ["Wayspot 的主體是入口名牌／景觀，而住宅本身並非一般觀光設施。"],
  questions: ["入口石材與景觀設計者是否有建築原始資料可查？"],
  sources: ["https://www.kencorp.co.jp/housing/properties/113107/?type=rent&view=search", "https://map.yahoo.co.jp/v3/place/Yc0D8yIXZUw"],
  location: { display: "東京都世田谷区駒沢1丁目2-33", city: "東京都", district: "世田谷区", locality: "駒沢1丁目", normalization_confidence: "high" },
});

define(["pc-0111", "pc-0112"], {
  confidence: "low",
  summary: "兩張獨立截圖都拍到三軒茶屋一丁目磚牆前的金屬驢／唐吉訶德造型雕塑。精確搜尋仍沒有找到作者、正式題名或設置單位；「鉄のドンキホーテ」很可能是玩家依材質與角色聯想所取的名稱。",
  facts: ["原圖可見磚牆前一件深色金屬人物／驢形立體物。", "兩張卡名稱、日期與地點相同但圖片checksum不同。"],
  inferences: ["標題可能把西班牙小說角色Don Quixote與金屬造型結合，並不代表作品官方名稱。"],
  questions: ["雕塑精確地址、銘牌、作者與建物關係為何？"],
  sources: [],
});

define(["pc-0113"], {
  confidence: "medium-low",
  summary: "原圖顯示「龍雲寺墓地」入口／墓園設施，遊戲地點標為野澤一丁目。官方龍雲寺則位於野澤三丁目、屬臨濟宗妙心寺派；地址不一致，故只能說墓地可能與寺院有關，不能直接把寺院本堂沿革套到墓地。",
  facts: ["官方大澤山龍雲寺位於世田谷區野澤3-38-1，屬臨濟宗妙心寺派。", "明信片地點欄為Nozawa 1-Chōme，與寺院本址不同。"],
  inferences: ["墓地可能是寺院的分離墓域，但目前沒有官方頁直接證明。"],
  questions: ["墓地的地籍地址、管理寺院與入口碑文字為何？"],
  sources: ["https://ryuun-ji.or.jp/about/", "https://ryuun-ji.or.jp/access/"],
});

low(["pc-0114"], "原圖中的「おじいさんの後ろ姿」是野澤四丁目牆面／停車場旁一個背向觀看者的老人剪影或小型裝飾。", "它是店家標誌、公共藝術、交通安全圖像或私人裝飾？作者與題名為何？");
low(["pc-0115"], "「水牆」位於臺北士林天福里，截圖顯示水沿深色直立牆面流下的景觀水景。", "水牆所屬建物／公園、設計者、循環水系統與落成年份為何？");

define(["pc-0116"], {
  confidence: "high",
  summary: "可定位為都立舊岩崎邸庭園內的小型石燈籠。園區是 1896 年為岩崎久彌建成的宅邸，保留和洋並置的建築與芝庭；專門參考資料記錄園內除著名雪見燈籠外，另有六角、丸形、四角與春日型燈籠。",
  facts: ["舊岩崎邸洋館由Josiah Conder設計，1896年完成。", "園內保存多種型制的石燈籠。"],
  inferences: ["Wayspot 刻意標「小さな灯籠」，應是用來區別園內更著名的大型雪見燈籠。"],
  questions: ["以原圖與園內配置圖確認它屬哪一種型制與確切位置。"],
  sources: ["https://www.tokyo-park.or.jp/park/kyu-iwasaki-tei/index.html", "https://crd.ndl.go.jp/reference/entry/index.php?id=1000370871&page=ref_view"],
});

define(["pc-0117"], {
  confidence: "low",
  summary: "原圖是川崎市久本三丁目一組直立彩色板件，上方可見「インフォメーション」字樣，像商場／開發區的導覽柱。未找到能把造型與正式設施名稱對上的來源。",
  facts: ["截圖地點欄為Kawasaki, Hisamoto 3-Chōme。", "畫面可見多條紅、橙、黃、綠、藍色直立板。"],
  inferences: ["可能位於溝之口站周邊商業或住宅開發的入口。"],
  questions: ["導覽柱上的完整文字、設置場所與設計單位為何？"],
  sources: [],
});

define(["pc-0118"], {
  confidence: "medium-high",
  summary: "「マスオさんのポール」是櫻新町「海螺小姐之町」街景的一部分：官方旅遊資料確認車站與サザエさん通り周邊設有全家角色造像；街道報導也明確記錄步道石柱刻有マスオ等角色臉孔。",
  facts: ["櫻新町周邊有12座海螺小姐家族銅像。", "サザエさん通り的人行道另有刻角色臉孔的石柱。"],
  inferences: ["這張不是車站前銅像本體，而是把角色融入日常街具的較小型地標。"],
  questions: ["該石柱在街上的精確位置與設置年份為何？"],
  sources: ["https://www.gotokyo.org/jp/spot/1183/", "https://sanpoo.jp/article/sazaesan-dori/"],
});

low(["pc-0119"], "「Doggy」是北投中央里一面鐵捲門彩繪，畫面為戴眼鏡／方框造型的狗臉。", "店址、作者、品牌關係與繪製年份為何？");

define(["pc-0120"], {
  confidence: "medium-high",
  summary: "可確認為福井縣敦賀市市橋的日吉神社。地方資料記錄它舊稱山王權現，並提出與式內「市振神社」相連的傳承；敦賀市文化財資料亦把神社後方自然環境列入指定項目。由於由緒主要來自地方史整理，細節仍宜保守表述。",
  facts: ["神社位於敦賀市市橋。", "地方史資料記錄舊稱山王權現，並保存市振神社相關傳承。"],
  inferences: ["明信片可作為愛發地區聚落信仰與古社傳承的入口。"],
  questions: ["目前祭神、社格與式內社比定的學術共識為何？"],
  sources: ["https://tangonotimei.com/etizen/turuga/itihasi.html", "https://www.city.tsuruga.lg.jp/uploaded/attachment/11146.pdf"],
});

define(["pc-0147"], {
  confidence: "high",
  summary: "可確認位於臺北市客家文化主題公園；官方 2016 年曾為 AR 遊戲錯名正名，Wayspot 的「麻花燈籠」其實是象徵團結的「結晶體」景觀。這張與 pc-0001 是同 POI／同日期但不同圖片的獨立紀錄。",
  facts: ["官方正名資料指出麻花燈籠實為結晶體。", "pc-0147與pc-0001的圖片checksum不同，仍各自保留。"],
  inferences: ["它是Niantic舊POI錯名跨遊戲延續的數位地標考古案例。"],
  questions: ["錯名最初由哪一套Wayspot資料建立、後續是否曾在其他遊戲修正？"],
  sources: ["https://hac.gov.taipei/cp.aspx?n=82E1749D4E2EE795", "https://ssl.thcp.org.tw/news/796"],
});

define(["pc-0148"], {
  confidence: "low",
  summary: "「T字管猴」與 pc-0002 的「丁字管猴」應是同一在地小物件的名稱變體，但找不到正式作品名、作者或公部門介紹。它的價值主要在怪趣味與早期 Wayspot 命名痕跡，不能把名稱當成正式藝術登錄。",
  facts: ["pc-0148與pc-0002地點、日期與可辨識物件相符，但圖片checksum不同。"],
  inferences: ["T字／丁字差異可能是轉寫變體或玩家改名。"],
  questions: ["現場物件是否仍存在，是否有可讀銘牌或管理單位？"],
  sources: ["https://li.taipei/"],
});

const countryGroups = [
  ["臺灣", "TW", [21, 22, 25, 27, 31, 33, 34, 36, 38, 39, 40, 41, 45, 54, 55, 56, 65, 69, 70, 82, 83, 85, 86, 88, 90, 91, 92, 95, 96, 99, 100, 101, 107, 108, 115, 119, 122, 123, 147, 148]],
  ["日本", "JP", [24, 26, 28, 46, 49, 51, 52, 53, 59, 60, 62, 67, 68, 71, 72, 74, 75, 78, 80, 81, 87, 89, 102, 104, 105, 106, 109, 110, 111, 112, 113, 114, 116, 117, 118, 120, 121, 124, 125, 126]],
  ["香港", "HK", [23, 29, 35, 44, 64, 73, 94, 98]],
  ["美國", "US", [30, 42]],
  ["法國", "FR", [37, 48]],
  ["韓國", "KR", [32, 84]],
  ["澳洲", "AU", [50, 61, 63, 76, 79]],
  ["菲律賓", "PH", [57]],
  ["瑞典", "SE", [58, 93, 97]],
  ["挪威", "NO", [77]],
  ["澳門", "MO", [66]],
  ["中國", "CN", [47]],
  ["加拿大", "CA", [43]],
];

const countryById = new Map();
for (const [country, countryCode, numbers] of countryGroups) {
  for (const number of numbers) countryById.set(`pc-${String(number).padStart(4, "0")}`, { country, country_code: countryCode });
}

const confidenceLabels = {
  high: "高",
  "medium-high": "中高",
  medium: "中",
  "medium-low": "中低",
  low: "低",
};

if (profiles.size !== targetIds.length) {
  const missing = targetIds.filter((id) => !profiles.has(id));
  const extra = [...profiles.keys()].filter((id) => !targetIds.includes(id));
  throw new Error(`Research profile coverage mismatch; missing=${missing.join(",")}; extra=${extra.join(",")}`);
}
if (countryById.size !== targetIds.length) {
  const missing = targetIds.filter((id) => !countryById.has(id));
  throw new Error(`Country coverage mismatch; missing=${missing.join(",")}`);
}

export function buildResearchRedo(record) {
  if (!targetIds.includes(record.id)) throw new Error(`${record.id} is not in the research redo manifest`);
  const profile = profiles.get(record.id);
  const country = countryById.get(record.id);
  const location = {
    ...country,
    normalization_confidence: profile.location?.normalization_confidence ?? "medium",
    ...profile.location,
  };
  const research = {
    status: "re-researched_after_compaction_gap_2026-08-23",
    confidence: profile.confidence,
    confidence_label: confidenceLabels[profile.confidence],
    summary: profile.summary,
    confirmed_facts: profile.facts,
    inferences: profile.inferences,
    unresolved_questions: profile.questions,
    sources: [...new Set(profile.sources)],
    detail: {
      status: "structured_preserved",
      body: buildDetail(record, profile),
      source_path: recoverySourcePath,
      preservation_note: null,
    },
  };
  return { location, research };
}

export function buildRecoveryMarkdown(postcards) {
  const byId = new Map(postcards.map((record) => [record.id, record]));
  const sections = targetIds.map((id) => {
    const record = byId.get(id);
    if (!record) throw new Error(`Missing ${id} while building research markdown`);
    const research = record.research.status === "re-researched_after_compaction_gap_2026-08-23"
      ? record.research
      : buildResearchRedo(record).research;
    return [
      `## ${record.id} · ${record.poi_name}`,
      "",
      `- Research status: current re-research after compacted-context gap`,
      `- Confidence: ${research.confidence_label} (${research.confidence})`,
      `- Screenshot location: ${record.location.raw}`,
      "",
      research.detail.body,
      "",
      "### Confirmed facts",
      "",
      ...(research.confirmed_facts.length ? research.confirmed_facts.map((item) => `- ${item}`) : ["- 無新增可獨立查證的外部事實；保留截圖層觀察。"]),
      "",
      "### Inferences",
      "",
      ...(research.inferences.length ? research.inferences.map((item) => `- ${item}`) : ["- 無。"]),
      "",
      "### Open questions",
      "",
      ...(research.unresolved_questions.length ? research.unresolved_questions.map((item) => `- ${item}`) : ["- 無。"]),
      "",
      "### Sources opened for this re-research",
      "",
      ...(research.sources.length ? research.sources.map((url) => `- ${url}`) : ["- 無可可靠對應到具體物件的外部來源；未以相似搜尋結果代填。"]),
    ].join("\n");
  });

  return [
    "# Pikmin postcard research redo · 2026-08-23",
    "",
    "This file contains new research performed after the export's compacted-context gap was discovered. It is not a recovery of the missing earlier assistant prose. The original screenshots, metadata and gap provenance remain preserved in the canonical records; every section below is explicitly current re-research.",
    "",
    ...sections.flatMap((section) => [section, ""]),
  ].join("\n").trimEnd() + "\n";
}

function buildDetail(record, profile) {
  const sourceSentence = profile.sources.length
    ? `本輪實際開啟並保存 ${profile.sources.length} 個相關來源；只有能直接支持主張的內容列入已確認事實。`
    : "本輪沒有找到能可靠對應到這個具體物件的外部來源；相似名稱、同名地點與搜尋片段均未被拿來補成結論。";
  const questionSentence = profile.questions.length
    ? `仍待確認：${profile.questions.join("；")}`
    : "目前沒有會改變此筆核心辨識的重大未解問題。";
  return `【2026-08-23 本輪重做研究；不是遺失原文的復原】${profile.summary} 研究以原始截圖、Wayspot 名稱「${record.poi_name}」與地點欄「${record.location.raw}」為起點，並把畫面觀察、外部事實和推論分開保存。${sourceSentence}${questionSentence}`;
}
