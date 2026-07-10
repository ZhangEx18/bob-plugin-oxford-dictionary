import * as Bob from "@bob-plug/core";
import { buildEcdictResult } from "./ecdict";
import { queryEcdictEntry } from "./ecdict-loader";
import { buildEntryView } from "./entry-view";
import { buildOaldResult } from "./oald-result";
import { isWordQuery, queryYoudaoDictionary, queryYoudaoTranslation } from "./youdao";

function completeError(
  completion: Bob.Completion,
  type: "unsupportLanguage" | "notFound" | "network",
  message: string,
): void {
  completion({ error: { type, message, addtion: "" } });
}

function queryYoudaoWord(
  text: string,
  sourceLang: string,
  targetLang: string,
  completion: Bob.Completion,
): void {
  queryYoudaoDictionary(text)
    .then((dictionaryResult) => {
      if (dictionaryResult) {
        completion({ result: dictionaryResult });
        return null;
      }
      return queryYoudaoTranslation(text, sourceLang, targetLang);
    })
    .then((translationResult) => {
      if (translationResult === null) return;
      if (translationResult) {
        completion({ result: translationResult });
      } else {
        completeError(completion, "notFound", "");
      }
    })
    .catch((error) => completeError(completion, "network", String(error)));
}

function queryGeneralTranslation(
  text: string,
  sourceLang: string,
  targetLang: string,
  completion: Bob.Completion,
): void {
  queryYoudaoTranslation(text, sourceLang, targetLang)
    .then((translationResult) => {
      if (translationResult) {
        completion({ result: translationResult });
      } else {
        completeError(completion, "notFound", "Translation failed");
      }
    })
    .catch((error) => completeError(completion, "network", String(error)));
}

export function translate(query: Bob.TranslateQuery, completion: Bob.Completion): void {
  if (!query || typeof query.text !== "string") {
    completeError(completion, "unsupportLanguage", "Invalid query");
    return;
  }

  const text = query.text.trim();
  if (!text) {
    completeError(completion, "unsupportLanguage", "Empty query");
    return;
  }

  const targetLang = query.detectTo || "zh-Hans";
  const sourceLang = query.detectFrom || "auto";
  if ((sourceLang === "en" || sourceLang === "auto") && isWordQuery(text)) {
    const oaldView = buildEntryView(text);
    if (oaldView) {
      completion({ result: buildOaldResult(oaldView) });
      return;
    }

    const ecdictEntry = queryEcdictEntry(text);
    if (ecdictEntry) {
      completion({ result: buildEcdictResult(ecdictEntry, text) });
      return;
    }

    queryYoudaoWord(text, sourceLang, targetLang, completion);
    return;
  }

  queryGeneralTranslation(text, sourceLang, targetLang, completion);
}
