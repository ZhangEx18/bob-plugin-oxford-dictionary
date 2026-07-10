import { getCrossReferences, getChildRelations, getOriginSources } from "./relations";
import { translate } from "./translate";
import { getYoudaoLanguages } from "./youdao";

function supportLanguages() {
  return getYoudaoLanguages();
}

export { supportLanguages, translate };

// Invariant tests use the same filtered navigation surface as the runtime.
export const __relationsForTests = {
  getChildRelations,
  getCrossReferences,
  getOriginSources,
};
