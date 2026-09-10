import { serviceUnavailable } from "@/src/shared/errors/app-error";

const dictionaryUrl = "https://krdict.korean.go.kr/api/search";

/**
 * The National Institute of Korean Language's Korean Basic Dictionary is the
 * source of truth for player-entered answers. Its key is server-only; the
 * browser never receives it or an affirmative validation flag it can forge.
 */
export async function isOfficialKoreanNoun(answer: string): Promise<boolean> {
  const key = process.env.FESTIVAL_KRDICT_API_KEY?.trim();
  if (!key) throw serviceUnavailable("초성퀴즈 사전 확인 설정이 아직 준비되지 않았습니다.");
  const normalized = answer.trim();
  const url = new URL(dictionaryUrl);
  url.searchParams.set("key", key);
  url.searchParams.set("q", normalized);
  url.searchParams.set("part", "word");
  url.searchParams.set("sort", "dict");
  url.searchParams.set("num", "10");
  try {
    const response = await fetch(url, { headers: { Accept: "application/xml" }, cache: "no-store" });
    if (!response.ok) throw new Error(`dictionary returned ${response.status}`);
    return parseDictionaryItems(await response.text()).some((entry) => entry.word === normalized && entry.partOfSpeech === "명사");
  } catch {
    throw serviceUnavailable("국립국어원 사전 확인을 할 수 없습니다. 잠시 후 다시 시도해 주세요.");
  }
}

function parseDictionaryItems(xml: string): Array<{ word: string; partOfSpeech: string }> {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => ({
    word: xmlText(match[1], "word"),
    partOfSpeech: xmlText(match[1], "pos"),
  }));
}

function xmlText(fragment: string, name: string): string {
  const match = new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${name}>`).exec(fragment);
  return match?.[1]?.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim() ?? "";
}
