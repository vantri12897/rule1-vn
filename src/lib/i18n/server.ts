import "server-only";
import { cookies } from "next/headers";
import { LANG_COOKIE, normalizeLang, translate, type Lang, type Vars } from "./core";

export async function getLang(): Promise<Lang> {
  return normalizeLang((await cookies()).get(LANG_COOKIE)?.value);
}

export async function getT() {
  const lang = await getLang();
  return { lang, t: (key: string, vars?: Vars) => translate(lang, key, vars) };
}
