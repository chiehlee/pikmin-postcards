import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { researchedLocationDisplay, validateLocationNaming } from "../lib/location-names.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const archivePath = path.join(projectRoot, "data/postcards.json");
const commit = process.argv.includes("--commit");

const groups = [
  group("zh-Hant-TW", "TW", "臺灣", [
    ["Aiguo, Zhongzheng District", "臺北市中正區愛國里"],
    ["Alian Village, Alian District", "高雄市阿蓮區阿蓮里"],
    ["Ankang, Xinyi District", "臺北市信義區安康里"],
    ["Baobu, Neihu District", "臺北市內湖區寶湖里"],
    ["Baxian, Beitou District", "臺北市北投區八仙里"],
    ["Changan, Beitou District", "臺北市北投區長安里"],
    ["Daoxiang, Beitou District", "臺北市北投區稻香里"],
    ["Datong, Beitou District", "臺北市北投區大同里"],
    ["Guangchun Village, Chaozhou Township", "屏東縣潮州鎮光春里"],
    ["Guolian Village, Hualien City", "花蓮縣花蓮市國聯里"],
    ["Huasheng, Daan District", "臺北市大安區華聲里"],
    ["Huyuan, Neihu District", "臺北市內湖區湖元里"],
    ["Jianmin, Beitou District", "臺北市北投區建民里"],
    ["Jiantan, Zhongshan District", "臺北市中山區劍潭里"],
    ["Kaiming, Beitou District", "臺北市北投區開明里"],
    ["Kanding Village, Tamsui District", "新北市淡水區崁頂里"],
    ["Liming, Zhongzheng District", "臺北市中正區黎明里"],
    ["Linxing, Zhongzheng District", "臺北市中正區林興里"],
    ["Longsheng, Daan District", "臺北市大安區龍生里"],
    ["Meihua, Zhongzheng District", "臺北市中正區梅花里"],
    ["Minde Village, Hualien City", "花蓮縣花蓮市民德里"],
    ["Minhui, Daan District", "臺北市大安區民輝里"],
    ["Neinan Village, Neimen District", "高雄市內門區內南里"],
    ["Puxin Village, Dayuan District", "桃園市大園區埔心里"],
    ["Qianxi, East District", "新竹市東區前溪里"],
    ["Qingjiang, Beitou District", "臺北市北投區清江里"],
    ["Quanan, Daan District", "臺北市大安區全安里"],
    ["Qunying Village, Dongshan Township", "宜蘭縣冬山鄉群英村"],
    ["Renyong, Shilin District", "臺北市士林區仁勇里"],
    ["Shezi, Shilin District", "臺北市士林區社子里"],
    ["Suxi Village, Suao Township", "宜蘭縣蘇澳鎮蘇西里"],
    ["Taixing Village, Dongshi District", "臺中市東勢區石城里"],
    ["Taoyuan, Beitou District", "臺北市北投區桃源里"],
    ["Tianfu, Shilin District", "臺北市士林區天福里"],
    ["Wenhua, Beitou District", "臺北市北投區文化里"],
    ["Xingbang Village, Qianzhen District", "高雄市前鎮區興邦里"],
    ["Xinren, Xinyi District", "臺北市信義區新仁里"],
    ["Xinzhuang, Zhongshan District", "臺北市中山區新庄里"],
    ["Yanliao Village, Shoufeng Township", "花蓮縣壽豐鄉鹽寮村"],
    ["Yide, Beitou District", "臺北市北投區一德里"],
    ["Zhongxin, Beitou District", "臺北市北投區中心里"],
    ["Zhongyang, Beitou District", "臺北市北投區中央里"],
    ["Zhongyuan, Zhongshan District", "臺北市中山區中原里"],
    ["Zhoumei, Beitou District", "臺北市北投區洲美里"],
    ["Zhuangjing Village, Banqiao District", "新北市板橋區莊敬里"],
  ]),
  group("zh-Hant-HK", "HK", "香港", [
    ["Causeway Bay", "銅鑼灣"],
    ["Jordan", "佐敦"],
    ["Kwun Tong", "觀塘"],
    ["Telford Gardens, Kowloon Bay", "九龍灣德福花園"],
    ["Tsim Sha Tsui", "尖沙咀"],
    ["Tsuen Wan", "荃灣"],
    ["Wan Chai", "灣仔"],
    ["Yau Ma Tei", "油麻地"],
  ]),
  group("zh-Hant-MO", "MO", "澳門", [
    ["Our Lady of Carmel, Taipa", "澳門氹仔嘉模堂區"],
  ]),
  group("zh-Hans-CN", "CN", "中國", [
    ["Shenzhen", "深圳市"],
  ]),
  group("ja", "JP", "日本", [
    ["(35.6443480, 139.7052670)", "東京都目黒区中目黒二丁目"],
    ["Chuo, Nihombashi 3-Chōme", "東京都中央区日本橋三丁目"],
    ["Echizen, Komeno", "福井県丹生郡越前町米ノ"],
    ["Higashiosaka, Kamiishikiricho 2-Chōme", "大阪府東大阪市上石切町二丁目"],
    ["Hirosaki, Mototeramachi", "青森県弘前市元寺町"],
    ["Hitachinaka, Ajigauracho", "茨城県ひたちなか市阿字ケ浦町"],
    ["Hitachinaka, Minatohoncho", "茨城県ひたちなか市湊本町"],
    ["Ikoma, Motomachi 1-Chōme", "奈良県生駒市元町一丁目"],
    ["Inakadate, Takahi Omagari", "青森県田舎館村高樋字大曲"],
    ["Kaga, Ikirimachi", "石川県加賀市伊切町"],
    ["Kawasaki, Hisamoto 3-Chōme", "神奈川県川崎市高津区久本三丁目"],
    ["Matsusaka, Iinancho Kayumi", "三重県松阪市飯南町粥見"],
    ["Meguro, Ebisu Minami 3-Chōme", "東京都目黒区中目黒二丁目"],
    ["Meguro, Megurohoncho 5-Chōme", "東京都目黒区目黒本町五丁目"],
    ["Meguro, Minami 3-Chōme", "東京都目黒区南三丁目"],
    ["Minato, Akasaka 2-Chōme", "東京都港区赤坂二丁目"],
    ["Minato, Higashishimbashi 1-Chōme", "東京都港区東新橋一丁目"],
    ["Minato, Nishiazabu 3-Chōme", "東京都港区西麻布三丁目"],
    ["Minato, Toranomon 2-Chōme", "東京都港区虎ノ門二丁目"],
    ["Narita, Sanrizuka Goryo", "千葉県成田市三里塚御料"],
    ["Nasu, Yumoto", "栃木県那須町湯本"],
    ["Oarai, Isohamacho", "茨城県大洗町磯浜町"],
    ["Okinoshima, Fuse", "島根県隠岐の島町布施"],
    ["Setagaya, Hanamizuki-dori Street (Kinutasen-Ato)", "東京都世田谷区花みず木通り（砧線跡）"],
    ["Setagaya, Kamiuma 3-Chōme", "東京都世田谷区上馬三丁目"],
    ["Setagaya, Kamiuma 4-Chōme", "東京都世田谷区上馬四丁目"],
    ["Setagaya, Komazawa 1-Chōme", "東京都世田谷区駒沢一丁目"],
    ["Setagaya, Nozawa 1-Chōme", "東京都世田谷区野沢一丁目"],
    ["Setagaya, Nozawa 4-Chōme", "東京都世田谷区野沢四丁目"],
    ["Setagaya, Sakurashimmachi 1-Chōme", "東京都世田谷区桜新町一丁目"],
    ["Setagaya, Sangenjaya 1-Chōme", "東京都世田谷区三軒茶屋一丁目"],
    ["Setagaya, Sangenjaya 2-Chōme", "東京都世田谷区三軒茶屋二丁目"],
    ["Setagaya, Taishido 2-Chōme", "東京都世田谷区太子堂二丁目"],
    ["Setagaya, Tamagawa-dori Avenue", "東京都世田谷区玉川通り"],
    ["Shibuya, Ebisu 1-Chōme", "東京都渋谷区恵比寿一丁目"],
    ["Shibuya, Ebisu Nishi 1-Chōme", "東京都渋谷区恵比寿西一丁目"],
    ["Shibuya, Kamiyamacho", "東京都渋谷区神山町"],
    ["Shinjuku, Hyakunincho 2-Chōme", "東京都新宿区百人町二丁目"],
    ["Shinshiro, Tomioka Higashigawa", "愛知県新城市富岡東川"],
    ["Taito, Ikenohata 1-Chōme", "東京都台東区池之端一丁目"],
    ["Tsuruga, Ichihashi", "福井県敦賀市市橋"],
    ["Tsuruga, Kutsumi", "福井県敦賀市沓見"],
    ["Urayasu", "千葉県浦安市"],
  ]),
  group("ko", "KR", "韓國", [
    ["(36.6768750, 127.3937000)", "충청북도 청주시 가락리", "忠清北道清州市佳樂里"],
    ["Seoul", "서울특별시", "首爾特別市"],
  ]),
  group("ms", "MY", "馬來西亞", [
    ["Kajang", "Kajang, Selangor", "雪蘭莪州加影"],
  ]),
  group("id", "ID", "印尼", [
    ["Ubud, Gianyar", "Ubud, Kabupaten Gianyar", "峇里省吉安雅縣烏布"],
  ]),
  group("en-US", "US", "美國", [
    ["Downtown, Laramie", "Downtown Laramie, Wyoming", "懷俄明州拉勒米市中心"],
    ["Laramie", "Laramie, Wyoming", "懷俄明州拉勒米"],
  ]),
  group("en-AU", "AU", "澳洲", [
    ["Albion Park Rail", "Albion Park Rail, New South Wales", "新南威爾斯州阿爾比恩帕克雷爾"],
    ["Bowral", "Bowral, New South Wales", "新南威爾斯州鮑勒爾"],
    ["Bundanoon", "Bundanoon, New South Wales", "新南威爾斯州班達努"],
  ]),
  group("en-CA", "CA", "加拿大", [
    ["Chinatown, Victoria", "Chinatown, Victoria, British Columbia", "卑詩省維多利亞華埠"],
  ]),
  group("fr", "FR", "法國", [
    ["Biarritz", "Biarritz", "比亞里茲"],
    ["Nantes", "Nantes", "南特"],
    ["Saint-Laurent-des-Autels, Orée d'Anjou", "Saint-Laurent-des-Autels, Orée-d’Anjou", "羅亞爾河地區奧雷當茹聖洛朗德索泰勒"],
  ]),
  group("en-PH", "PH", "菲律賓", [
    ["San Francisco, General Trias", "San Francisco, General Trias, Cavite", "甲米地省將軍特里亞斯市聖弗朗西斯科"],
  ]),
  group("sv", "SE", "瑞典", [
    ["Ryd, Linköping", "Ryd, Linköping", "林雪平市里德"],
    ["Ullevi, Färjestaden", "Ullevi, Färjestaden", "費里耶斯塔登烏勒維"],
  ]),
  group("nb", "NO", "挪威", [
    ["Arna, Trengereid", "Trengereid, Arna, Bergen", "卑爾根市阿納區特倫厄雷德"],
  ]),
  group("mn", "MN", "蒙古", [
    ["Ulaanbaatar", "Улаанбаатар", "烏蘭巴托"],
  ]),
];

const recordOverrides = {
  "pc-0022": ["臺中市東勢區石城里石城街178號", null],
  "pc-0033": ["新北市淡水區中山北路二段381巷2號", null],
  "pc-0063": ["Corbett Gardens, Bowral, New South Wales", "新南威爾斯州鮑勒爾科貝特花園"],
  "pc-0079": ["Rivulet Park, Bowral, New South Wales", "新南威爾斯州鮑勒爾里弗萊特公園"],
  "pc-0099": ["臺北市北投區光明路157巷2弄光明橋", null],
  "pc-0107": ["臺北市北投區大同街15號", null],
  "pc-0109": ["東京都世田谷区駒沢一丁目2-33", null],
  "pc-0121": ["東京都世田谷区駒沢一丁目2-33", null],
  "pc-0123": ["臺北市北投區大同街15號", null],
};
const highConfidenceIds = new Set(["pc-0089"]);

const archive = JSON.parse(await readFile(archivePath, "utf8"));
const registry = new Map(groups.flat().map((entry) => [entry.raw, entry]));
const missing = [];
const changed = [];

for (const postcard of archive.postcards) {
  const naming = registry.get(postcard.location.raw);
  if (!naming) {
    missing.push(`${postcard.id}: ${postcard.location.raw}`);
    continue;
  }
  const override = recordOverrides[postcard.id];
  const nextLocation = {
    ...postcard.location,
    endonym: override?.[0] ?? naming.endonym,
    zh_tw: override ? override[1] : naming.zh_tw,
    language: naming.language,
    name_status: postcard.research.sources?.length ? "researched" : "provisional",
    name_confidence: highConfidenceIds.has(postcard.id)
      ? "high"
      : postcard.research.sources?.length ? "medium" : "low",
    country: naming.country,
    country_code: naming.country_code,
    normalization_confidence: postcard.location.normalization_confidence === "unreviewed"
      ? "medium"
      : postcard.location.normalization_confidence,
  };
  nextLocation.display = researchedLocationDisplay(nextLocation);
  const errors = validateLocationNaming(nextLocation);
  if (errors.length) throw new Error(`${postcard.id}: ${errors.join("; ")}`);
  if (JSON.stringify(postcard.location) !== JSON.stringify(nextLocation)) changed.push(postcard.id);
  postcard.location = nextLocation;
}

if (missing.length) throw new Error(`Missing location-name research:\n${missing.join("\n")}`);

archive.schema_version = Math.max(archive.schema_version ?? 1, 4);
console.log(JSON.stringify({ records: archive.postcards.length, changed: changed.length, commit }, null, 2));

if (commit) {
  const temporary = `${archivePath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(archive, null, 2)}\n`, "utf8");
  await rename(temporary, archivePath);
}

function group(language, countryCode, country, entries) {
  return entries.map(([raw, endonym, zhTw = null]) => ({
    raw,
    endonym,
    zh_tw: zhTw,
    language,
    country_code: countryCode,
    country,
  }));
}
