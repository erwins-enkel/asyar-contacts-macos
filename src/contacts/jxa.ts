// ─────────────────────────────────────────────────────────────────────────
// The macOS side of this extension, as a string.
//
// Asyar extensions cannot ship or compile a native helper: the only route to
// the OS is `ShellService.spawn()`, which runs an already-installed binary
// and cannot write to its stdin. So the helper is handed to `/usr/bin/osascript`
// on the command line — `osascript -l JavaScript -e <this> <mode> [arg]` —
// and JavaScript for Automation's ObjC bridge talks to the Contacts framework
// directly. That matters for two reasons:
//
//   - It never launches Contacts.app, so there is no Apple-Events/Automation
//     prompt and no several-second app launch. The relevant TCC gate is the
//     Contacts one, checked below before a single record is read.
//   - `CNContactStore.enumerateContacts` streams. ~2700 contacts come back in
//     roughly three seconds, which is why the panel caches the result rather
//     than re-reading on every open.
//
// Output is one JSON object per line (see `HelperLine`), because ShellService
// delivers stdout line by line with the newline stripped. Contacts go out in
// batches of 250 rather than one object each: 2700 separate postMessage round
// trips cost far more than eleven fat ones.
//
// Keep this file dependency-free ES5. It is not compiled by our TypeScript
// build — it is a string that osascript's JavaScriptCore parses.
//
// The first line is a comment on purpose. Asyar promotes every `shell.spawn()`
// to a tracked "run" whose label is `program + args` truncated to 100
// characters, and those runs surface in the launcher's own search results. With
// the script starting straight into `ObjC.import(...)`, that label was a slab of
// JavaScript sitting in the user's launcher after every load. Leading with a
// comment costs nothing and makes the truncated label say what it is.
// ─────────────────────────────────────────────────────────────────────────

export const BATCH_SIZE = 250;

export const CONTACTS_JXA = String.raw`// Asyar · Contacts — reading your macOS address book
ObjC.import('Contacts');
ObjC.import('Foundation');

function s(v) {
  try { var u = ObjC.unwrap(v); return typeof u === 'string' ? u : ''; }
  catch (e) { return ''; }
}

function emit(o) {
  $.NSFileHandle.fileHandleWithStandardOutput.writeData(
    $(JSON.stringify(o) + '\n').dataUsingEncoding($.NSUTF8StringEncoding)
  );
}

// Localizing a label is a framework call, and the same handful of labels
// ("_$!<Mobile>!$_", "_$!<Work>!$_", …) repeat across thousands of records.
// Memoizing turns tens of thousands of bridge crossings into a dozen.
var LABELS = {};
function localizedLabel(raw) {
  if (!raw || raw.isNil()) return '';
  var key = s(raw);
  if (key === '') return '';
  if (!(key in LABELS)) LABELS[key] = s($.CNLabeledValue.localizedStringForLabel(raw));
  return LABELS[key];
}

function labeled(list, valueFn) {
  var out = [];
  if (!list) return out;
  var n = Number(list.count);
  for (var i = 0; i < n; i++) {
    var lv = list.objectAtIndex(i);
    var value = valueFn(lv.value);
    if (value) out.push({ l: localizedLabel(lv.label), v: value });
  }
  return out;
}

function authStatus() {
  return Number($.CNContactStore.authorizationStatusForEntityType($.CNEntityTypeContacts));
}

function run(argv) {
  var mode = argv[0] || 'list';

  if (mode === 'auth') { emit({ auth: authStatus() }); return; }

  var store = $.CNContactStore.alloc.init;

  // Fires the system's Contacts prompt and blocks on a run loop until the
  // user answers, because osascript would otherwise exit before the
  // completion handler ran. Two minutes is the ceiling; a user who has not
  // answered by then has walked away and the panel reports "not authorized".
  if (mode === 'request') {
    var done = false, granted = false;
    store.requestAccessForEntityTypeCompletionHandler($.CNEntityTypeContacts, function (ok) {
      granted = ok; done = true;
    });
    var deadline = $.NSDate.dateWithTimeIntervalSinceNow(120);
    while (!done && $.NSDate.date.compare(deadline) < 0) {
      $.NSRunLoop.currentRunLoop.runModeBeforeDate(
        $.NSDefaultRunLoopMode, $.NSDate.dateWithTimeIntervalSinceNow(0.1)
      );
    }
    emit({ auth: authStatus(), granted: granted ? 1 : 0 });
    return;
  }

  // One contact's photo, on demand. Fetched separately from the index: photo
  // data is orders of magnitude larger than the rest of a record, and the
  // panel only ever needs the one that is highlighted.
  if (mode === 'image') {
    var ident = argv[1] || '';
    if (ident === '') { emit({ error: 'no_identifier' }); return; }
    var ierr = Ref();
    var c = store.unifiedContactWithIdentifierKeysToFetchError(
      ident, $(['imageData', 'thumbnailImageData']), ierr
    );
    if (!c || c.isNil()) { emit({ error: 'not_found' }); return; }
    var data = c.thumbnailImageData;
    if (!data || data.isNil()) { emit({ image: null }); return; }
    emit({ image: s(data.base64EncodedStringWithOptions(0)) });
    return;
  }

  // mode === 'list'
  var status = authStatus();
  emit({ auth: status });
  if (status !== 3) { emit({ error: 'not_authorized', auth: status }); return; }

  // The Mac's own region, so a national number can be promoted to E.164
  // without asking the user to name their country twice.
  emit({ region: s($.NSLocale.currentLocale.countryCode) });

  var keys = $([
    'identifier', 'givenName', 'middleName', 'familyName', 'nickname',
    'organizationName', 'jobTitle', 'phoneNumbers', 'emailAddresses',
    'imageDataAvailable', 'contactType'
  ]);
  var req = $.CNContactFetchRequest.alloc.initWithKeysToFetch(keys);
  req.sortOrder = $.CNContactSortOrderUserDefault;

  var batch = [], total = 0;
  var err = Ref();
  var ok = store.enumerateContactsWithFetchRequestErrorUsingBlock(req, err, function (c) {
    var entry = {
      id: s(c.identifier),
      g: s(c.givenName), m: s(c.middleName), f: s(c.familyName),
      n: s(c.nickname), o: s(c.organizationName), j: s(c.jobTitle),
      c: Number(c.contactType) === 1 ? 1 : 0,
      a: c.imageDataAvailable ? 1 : 0
    };
    var phones = labeled(c.phoneNumbers, function (v) { return s(v.stringValue); });
    var emails = labeled(c.emailAddresses, function (v) { return s(v); });
    if (phones.length) entry.p = phones;
    if (emails.length) entry.e = emails;

    // Records with neither a name nor a way to reach anyone are noise —
    // usually leftovers from a half-finished sync.
    if (!(entry.g || entry.f || entry.o || entry.n || entry.p || entry.e)) return;

    batch.push(entry); total++;
    if (batch.length >= __BATCH__) { emit({ batch: batch }); batch = []; }
  });

  if (batch.length) emit({ batch: batch });
  if (!ok) { emit({ error: 'enumerate_failed' }); return; }
  emit({ done: total });
}
`.replace('__BATCH__', String(BATCH_SIZE));

/** The binary `ShellService.spawn()` is asked for. Declared in the manifest's
 *  `permissionArgs["shell:spawn"]`, so the user approves it once in the
 *  install/enable consent dialog rather than meeting a surprise prompt the
 *  first time the scheduled background refresh fires. */
export const HELPER_PROGRAM = 'osascript';

export type HelperMode = 'list' | 'auth' | 'request' | 'image';

export function helperArgs(mode: HelperMode, argument?: string): string[] {
  const args = ['-l', 'JavaScript', '-e', CONTACTS_JXA, mode];
  if (argument !== undefined) args.push(argument);
  return args;
}
