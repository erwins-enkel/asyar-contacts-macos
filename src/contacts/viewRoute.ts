// ─────────────────────────────────────────────────────────────────────────
// Which panel to mount, and on whom.
//
// Asyar addresses a view by a `viewPath` of the form `<extensionId>/<Component>`,
// and `ExtensionIframe` turns it into the iframe URL by pasting the second half
// into a query parameter, unencoded:
//
//     `…/view.html?view=${view.split('/')[1] || 'DefaultView'}`
//
// That is the only channel from a root-search row into the panel. An `actionId`
// on a search result looks like a second one but is not: `searchResultMapper`
// runs the host-side `action` closure first, and `extensionSearchAggregator`
// attaches such a closure to every Tier 2 result, so the branch that would have
// dispatched the action is unreachable. The closure only navigates — the row's
// `viewPath` is all it passes on.
//
// So the contact identifier rides in the view path, and this module takes it
// back out. Everything here is pure; `view.ts` does the mounting.
// ─────────────────────────────────────────────────────────────────────────

export interface ViewRoute {
  /** The component Asyar asked for. Empty when the parameter is absent. */
  component: string;
  /** The contact to open on, when the path carried one. */
  selection: string | null;
}

export function parseViewRoute(search: string): ViewRoute {
  const raw = new URLSearchParams(search).get('view') ?? '';
  const cut = raw.indexOf('?');
  if (cut === -1) return { component: raw, selection: null };

  const component = raw.slice(0, cut);
  const rest = raw.slice(cut + 1);
  // Read the value directly rather than through URLSearchParams a second time:
  // the outer parse already decoded it once, and decoding twice would corrupt
  // an identifier that legitimately contains a percent sign.
  const selection = rest.startsWith('id=') ? rest.slice(3) : '';
  return { component, selection: selection === '' ? null : selection };
}
