import { shardKeyForWord } from "./data-loader";
import { buildEntryView } from "./entry-view";
import { getCrossReferences, getChildRelations, getOriginSources } from "./relations";
import { translate } from "./translate";
import { getYoudaoLanguages, isWordQuery } from "./youdao";

function supportLanguages() {
  return getYoudaoLanguages();
}

/**
 * Bob allows 30-300 seconds and defaults to 60.
 *
 * The default is not enough for long text: Youdao caps a single request near
 * 1,000 characters, so the text is sent in 900-character segments, and the
 * endpoint rate-limits after a handful of them. Absorbing that limit needs
 * backoff, which pushes a long translation past 60 seconds; without the raised
 * budget Bob would abort while the plugin was still recovering.
 */
function pluginTimeoutInterval() {
  return 300;
}

export { supportLanguages, translate, pluginTimeoutInterval };

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
