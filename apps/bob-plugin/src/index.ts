import { shardKeyForWord } from "./data-loader";
import { buildEntryView } from "./entry-view";
import { getCrossReferences, getChildRelations, getOriginSources } from "./relations";
import { translate } from "./translate";
import { getYoudaoLanguages, isWordQuery } from "./youdao";

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

// Lets the pack invariant assert that every stored entry's key derives back to
// the shard file it lives in, using the runtime's own derivation.
export const __dataLoaderForTests = {
  shardKeyForWord,
};

// Lets the pack invariant assert that every stored entry the router accepts is
// actually renderable, using the same view builder and gate the runtime uses.
export const __querySurfaceForTests = {
  buildEntryView,
  isWordQuery,
};
