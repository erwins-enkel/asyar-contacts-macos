<script lang="ts">
  // ───────────────────────────────────────────────────────────────────────
  // The panel.
  //
  // Two things shape the whole file:
  //
  //   1. The launcher's own search bar is the filter input. There is no
  //      <input> here, and there must not be one — focus stays in the parent
  //      window, the query arrives as `asyar:view:search`, and the six
  //      navigation keys arrive as `asyar:view:keydown`. Selection is
  //      therefore virtual state (`selectedId`), never DOM focus: calling
  //      .focus() on a row would stop the typing that drives the filter.
  //
  //   2. Reading the address book costs seconds, so the cached index paints
  //      first and the fresh read lands behind it.
  // ───────────────────────────────────────────────────────────────────────
  import { untrack } from 'svelte';
  import {
    ActionCategory,
    ActionContext,
    ClipboardItemType,
    type ExtensionAction,
    type ExtensionContext,
    type ICacheService,
    type IClipboardHistoryService,
    type IShellService,
  } from 'asyar-sdk/contracts';

  import { clearIndex, isStale, readIndex, writeIndex } from './contacts/cache';
  import { diagnoseError, diagnoseFailure, type Diagnosis } from './contacts/diagnose';
  import { intentFor, SHORTCUT_HINTS, type Intent } from './contacts/keys';
  import {
    checkAuthorization,
    loadIndex,
    loadPhoto,
    requestAuthorization,
  } from './contacts/loader';
  import { addressBookUrl, mailUrl, reachUrl, type ReachAction } from './contacts/phone';
  import { filterContacts } from './contacts/search';
  import { cycleIndex, moveSelection, settleSelection } from './contacts/selection';
  import { AUTH, type Contact, type PhoneNumber } from './contacts/types';
  import { openExternal } from './opener';

  let { context, extensionId }: { context: ExtensionContext; extensionId: string } = $props();

  /** The DOM holds this many rows at most. A 2700-row address book renders
   *  fine once and scrolls badly forever after; the cap keeps the panel
   *  responsive, and the count of what it hides is shown rather than
   *  swallowed — see the "weitere" line under the list. */
  const MAX_ROWS = 200;
  const SYSTEM_SETTINGS_CONTACTS =
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Contacts';

  type Status = 'loading' | 'ready' | 'denied' | 'permissions' | 'error';

  let status = $state<Status>('loading');
  let statusDetail = $state('');
  let contacts = $state<Contact[]>([]);
  let indexedAt = $state<number | null>(null);
  let refreshing = $state(false);

  let query = $state('');
  let selectedId = $state<string | null>(null);
  /** Which of the highlighted contact's numbers ← → have walked to. Reset
   *  whenever the highlight moves, so a per-contact choice never leaks onto
   *  the next contact. */
  let numberIndex = $state(0);

  let notice = $state<string | null>(null);
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  /** Photos are fetched one at a time, for the highlighted contact only —
   *  image data dwarfs the rest of a record, so it stays out of the index.
   *  Memoized by contact id because arrowing up and down a list revisits the
   *  same handful of people constantly. */
  const photoCache = new Map<string, string | null>();
  let photo = $state<string | null>(null);
  let photoTimer: ReturnType<typeof setTimeout> | undefined;

  // Preferences are read once at mount; the launcher reloads the extension
  // when the user edits them, so there is nothing to re-read.
  let primaryAction = $state<ReachAction>('call');
  let showAvatars = $state(true);

  // Read through a closure rather than a module-level const: `context` is a
  // prop, and capturing its initial value at component init is exactly the
  // pattern Svelte 5 warns about. `getService` is a lookup in the proxy bag,
  // so calling it per use costs nothing.
  const cache = (): ICacheService => context.getService<ICacheService>('cache');
  const shell = (): IShellService => context.getService<IShellService>('shell');

  // ── Derived list ──────────────────────────────────────────────────────
  let matched = $derived(filterContacts(contacts, query));
  let rows = $derived(matched.slice(0, MAX_ROWS));
  let hiddenCount = $derived(matched.length - rows.length);
  let visibleIds = $derived(rows.map((c) => c.id));
  let selected = $derived(rows.find((c) => c.id === selectedId) ?? null);
  let activePhone = $derived<PhoneNumber | null>(
    selected && selected.phones.length > 0
      ? (selected.phones[Math.min(numberIndex, selected.phones.length - 1)] ?? null)
      : null,
  );

  // ── Preferences ───────────────────────────────────────────────────────
  interface Prefs {
    primaryAction: ReachAction;
    countryCode: string;
    preferredLabels: string;
    showAvatars: boolean;
    includeOrganizations: boolean;
  }

  function str(values: Record<string, unknown>, key: string, fallback: string): string {
    const value = values[key];
    return typeof value === 'string' && value.trim() !== '' ? value : fallback;
  }

  function bool(values: Record<string, unknown>, key: string, fallback: boolean): boolean {
    const value = values[key];
    return typeof value === 'boolean' ? value : fallback;
  }

  /** `context.preferences.values` is a permission-free synchronous read off a
   *  frozen snapshot — but the snapshot can boot empty, in which case
   *  `refresh()` (IPC, needs `preferences:read`) fills it. */
  async function readPrefs(): Promise<Prefs> {
    let values = (context.preferences.values ?? {}) as Record<string, unknown>;
    if (typeof values.primaryAction !== 'string') {
      // `refresh()` is gated on `preferences:read`, and a withheld consent
      // rejects it. Defaults are a complete, working configuration — losing
      // the user's tuning is a far better outcome than a blank panel, and the
      // permission screen still gets shown by whichever gated call fails next.
      try {
        values = (await context.preferences.refresh()) as Record<string, unknown>;
      } catch {
        values = {};
      }
    }
    return {
      primaryAction: str(values, 'primaryAction', 'call') as ReachAction,
      countryCode: str(values, 'countryCode', 'auto'),
      preferredLabels: str(values, 'preferredLabels', 'iPhone, Mobil, Mobile, Handy, Privat'),
      showAvatars: bool(values, 'showAvatars', true),
      includeOrganizations: bool(values, 'includeOrganizations', true),
    };
  }

  // ── Loading ───────────────────────────────────────────────────────────
  /** Every failure lands here, so there is exactly one place that decides
   *  which screen the user sees and what it tells them to do. */
  function show(diagnosis: Diagnosis): void {
    status =
      diagnosis.kind === 'permissions'
        ? 'permissions'
        : diagnosis.kind === 'contacts-access'
          ? 'denied'
          : 'error';
    statusDetail = diagnosis.detail;
  }

  function applyIndex(next: Contact[], at: number): void {
    contacts = next;
    indexedAt = at;
    status = 'ready';
    statusDetail = '';
  }

  /** Read the address book and replace the index. `silent` keeps the already
   *  rendered list on screen while the fresh read runs behind it — the whole
   *  point of caching. */
  async function refresh(silent: boolean): Promise<void> {
    if (refreshing) return;
    refreshing = true;
    if (!silent) status = 'loading';

    try {
      const prefs = await readPrefs();
      primaryAction = prefs.primaryAction;
      showAvatars = prefs.showAvatars;

      const result = await loadIndex(shell(), {
        countryCode: prefs.countryCode,
        preferredLabels: prefs.preferredLabels,
        includeOrganizations: prefs.includeOrganizations,
      });

      if (!result.ok) {
        const diagnosis = diagnoseFailure(result.failure);
        // A failed background refresh must not blank a list that is already
        // on screen — it becomes a notice instead of a state change.
        if (silent && contacts.length > 0) {
          showNotice(diagnosis.detail);
          return;
        }
        show(diagnosis);
        return;
      }

      applyIndex(result.value.contacts, result.value.at);
      photoCache.clear();
      void writeIndex(cache(), result.value).catch(() => {
        // A cache that will not accept the index costs the next open three
        // seconds. It does not cost this one anything, so it is not an error
        // worth interrupting the user for.
      });
    } catch (error) {
      // Anything that throws rather than resolving to a failure — a gated SDK
      // call rejecting, most likely. Without this the panel sat on its
      // spinner forever and the launcher showed a bare "promise was rejected".
      const diagnosis = diagnoseError(error);
      if (silent && contacts.length > 0) showNotice(diagnosis.detail);
      else show(diagnosis);
    } finally {
      refreshing = false;
    }
  }

  async function boot(): Promise<void> {
    try {
      const prefs = await readPrefs();
      primaryAction = prefs.primaryAction;
      showAvatars = prefs.showAvatars;

      const cached = await readIndex(cache());
      if (cached !== null && cached.contacts.length > 0) {
        applyIndex(cached.contacts, cached.at);
        if (isStale(cached)) void refresh(true);
        return;
      }

      // Nothing cached: ask about authorization before spawning a full read,
      // so a first run that is going to be refused says so immediately
      // instead of after a timeout.
      const auth = await checkAuthorization(shell());
      if (auth === AUTH.denied || auth === AUTH.restricted) {
        show(diagnoseFailure({ kind: 'not-authorized', auth }));
        return;
      }
      await refresh(false);
    } catch (error) {
      show(diagnoseError(error));
    }
  }

  async function grantAccess(): Promise<void> {
    status = 'loading';
    try {
      const auth = await requestAuthorization(shell());
      if (auth === AUTH.authorized) {
        await refresh(false);
        return;
      }
      show(diagnoseFailure({ kind: 'not-authorized', auth }));
      if (auth === AUTH.denied) {
        statusDetail =
          'Access was denied. It can now only be granted again in System Settings.';
      }
    } catch (error) {
      show(diagnoseError(error));
    }
  }

  async function reload(): Promise<void> {
    try {
      await clearIndex(cache());
      photoCache.clear();
      photo = null;
      await refresh(false);
    } catch (error) {
      show(diagnoseError(error));
    }
  }

  // ── Notices ───────────────────────────────────────────────────────────
  function showNotice(message: string): void {
    notice = message;
    if (noticeTimer !== undefined) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      notice = null;
      noticeTimer = undefined;
    }, 4000);
  }

  // ── Reaching a contact ────────────────────────────────────────────────
  async function copyToClipboard(value: string, confirmation: string): Promise<void> {
    try {
      const clipboard = context.getService<IClipboardHistoryService>('clipboard');
      await clipboard.writeToClipboard({
        id: `contacts-${Date.now()}`,
        type: ClipboardItemType.Text,
        content: value,
        createdAt: Date.now(),
        favorite: false,
      });
      showNotice(confirmation);
    } catch {
      showNotice("Couldn't copy that.");
    }
  }

  /** Hand a URL to macOS, then get out of the way. The launcher stays open on
   *  failure so the message is readable. */
  async function launch(url: string, failure: string): Promise<void> {
    const route = await openExternal(url);
    if (route === 'failed') {
      showNotice(failure);
      return;
    }
    context.hideLauncher();
  }

  async function reach(action: ReachAction): Promise<void> {
    const contact = selected;
    if (contact === null) return;

    if (action === 'email') {
      const address = contact.emails[0]?.address;
      const url = address === undefined ? null : mailUrl(address);
      if (url === null) {
        showNotice(`${contact.name} has no email address.`);
        return;
      }
      await launch(url, "Couldn't open the mail app.");
      return;
    }

    const phone = activePhone;
    if (phone === null) {
      showNotice(`${contact.name} has no phone number.`);
      return;
    }

    if (action === 'copy') {
      await copyToClipboard(phone.dial, `Copied ${phone.dial}.`);
      return;
    }

    const url = reachUrl(action, phone.dial);
    if (url === null) {
      // For WhatsApp this is the one specific, fixable cause: its scheme needs
      // bare E.164 digits, so a nationally-stored number has nothing to send.
      showNotice(
        action === 'whatsapp'
          ? `${phone.display} has no country code. WhatsApp needs one — set it under Settings → Country code.`
          : 'That number cannot be dialled.',
      );
      return;
    }
    await launch(url, `Couldn't open ${url.split(':')[0]}:.`);
  }

  async function openInContacts(): Promise<void> {
    const contact = selected;
    if (contact === null) return;
    const url = addressBookUrl(contact.id);
    if (url === null) {
      showNotice('This entry has no valid Contacts identifier.');
      return;
    }
    await launch(url, "Couldn't open the Contacts app.");
  }

  function applyIntent(intent: Intent): void {
    switch (intent.kind) {
      case 'move':
        selectedId = moveSelection(visibleIds, selectedId, intent.direction);
        scrollSelectionIntoView();
        return;
      case 'cycle-number': {
        const count = selected?.phones.length ?? 0;
        if (count <= 1) return;
        numberIndex = cycleIndex(count, numberIndex, intent.direction);
        return;
      }
      case 'reach':
        void reach(intent.action).catch((error: unknown) => show(diagnoseError(error)));
        return;
      case 'open-in-contacts':
        void openInContacts().catch((error: unknown) => show(diagnoseError(error)));
        return;
    }
  }

  // ── Wiring to the launcher ────────────────────────────────────────────
  let containerEl = $state<HTMLElement | null>(null);

  function scrollSelectionIntoView(): void {
    if (containerEl === null || selectedId === null) return;
    containerEl
      .querySelector<HTMLElement>(`[data-contact-id="${CSS.escape(selectedId)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }

  function handleParentMessage(event: MessageEvent): void {
    if (event.source !== window.parent) return;
    const data = event.data as { type?: unknown; payload?: Record<string, unknown> } | null;
    const type = data?.type;

    if (type === 'asyar:view:keydown') {
      const key = data?.payload?.key;
      if (typeof key !== 'string') return;
      const intent = intentFor(
        {
          key,
          metaKey: data?.payload?.metaKey === true,
          ctrlKey: data?.payload?.ctrlKey === true,
          shiftKey: data?.payload?.shiftKey === true,
          altKey: data?.payload?.altKey === true,
        },
        primaryAction,
      );
      if (intent !== null) applyIntent(intent);
      return;
    }

    if (type !== 'asyar:view:search' && type !== 'asyar:view:submit') return;
    const next = data?.payload?.query;
    if (typeof next !== 'string') return;
    query = next;
  }

  /** The DOM path, for when focus is genuinely inside the iframe — which only
   *  happens after a mouse click on a row. Same intents, same handler. */
  function handleDomKeydown(event: KeyboardEvent): void {
    const intent = intentFor(event, primaryAction);
    if (intent === null) return;
    event.preventDefault();
    applyIntent(intent);
  }

  $effect(() => {
    window.addEventListener('message', handleParentMessage);
    return () => window.removeEventListener('message', handleParentMessage);
  });

  // Hold the highlight on a row that is actually on screen: the top one when
  // the list loads, or when filtering hid the previous pick. `selectedId` is
  // read through `untrack` because this effect writes it.
  $effect(() => {
    const settled = settleSelection(visibleIds, untrack(() => selectedId));
    if (settled !== untrack(() => selectedId)) selectedId = settled;
  });

  // A new contact starts at its own first number.
  $effect(() => {
    void selectedId;
    numberIndex = 0;
  });

  // Photo for the highlighted contact, fetched after a short pause so holding
  // ArrowDown does not spawn one osascript per row.
  $effect(() => {
    const contact = selected;
    if (photoTimer !== undefined) clearTimeout(photoTimer);

    if (!showAvatars || contact === null || !contact.hasPhoto) {
      photo = null;
      return;
    }

    const cached = photoCache.get(contact.id);
    if (cached !== undefined) {
      photo = cached;
      return;
    }

    photo = null;
    const id = contact.id;
    photoTimer = setTimeout(() => {
      void loadPhoto(shell(), id)
        .then((data) => {
          photoCache.set(id, data);
          if (untrack(() => selected)?.id === id) photo = data;
        })
        // A missing avatar is not worth a screen. Remember the miss so the
        // next pass over this row does not spawn osascript again.
        .catch(() => photoCache.set(id, null));
    }, 180);

    return () => {
      if (photoTimer !== undefined) clearTimeout(photoTimer);
    };
  });

  // ⌘K drawer.
  //
  // Tearing these down is harder than it looks, and getting it wrong is
  // visible: the actions show up in *other* extensions' panels. Two things
  // conspire.
  //
  //   1. The host filters the drawer by context alone.
  //      `filterActionsByContext` in the launcher's actionService compares
  //      `action.context === currentContext` and nothing else — so
  //      `ActionContext.EXTENSION_VIEW` means "some extension panel is open",
  //      not "*this* panel is open". There is no per-extension scoping to opt
  //      into, and the `visible` predicate the host consults is host-side only.
  //
  //   2. The host only cleans up on the way back to the root.
  //      `selectionEffects` calls `clearActionsForExtension` under
  //      `currentView === null`. Navigating straight from this panel to
  //      another extension's panel never passes through null, so nothing is
  //      cleared.
  //
  // A Svelte `onDestroy` does not save us either: switching views destroys the
  // whole iframe (`{#key extensionId}` around `ExtensionIframe`), so this
  // component is never gracefully unmounted — its JS context simply ends.
  //
  // Hence `pagehide`: it fires while the frame is still alive enough to post a
  // message, and the parent window that receives it outlives us. That is the
  // one moment where the teardown can still be announced.
  $effect(() => {
    const actions: ExtensionAction[] = [
      {
        id: 'call',
        title: 'Call',
        description: 'Dials the highlighted number through Phone and your iPhone.',
        icon: '📞',
        shortcut: '⏎',
        extensionId,
        category: ActionCategory.PRIMARY,
        context: ActionContext.EXTENSION_VIEW,
        execute: () => reach('call'),
      },
      {
        id: 'facetime',
        title: 'FaceTime Video',
        icon: '🎥',
        shortcut: '⌘⏎',
        extensionId,
        category: ActionCategory.PRIMARY,
        context: ActionContext.EXTENSION_VIEW,
        execute: () => reach('facetime'),
      },
      {
        id: 'facetime-audio',
        title: 'FaceTime Audio',
        icon: '🎧',
        extensionId,
        category: ActionCategory.PRIMARY,
        context: ActionContext.EXTENSION_VIEW,
        execute: () => reach('facetime-audio'),
      },
      {
        id: 'sms',
        title: 'Send a message',
        icon: '💬',
        shortcut: '⌥⏎',
        extensionId,
        category: ActionCategory.PRIMARY,
        context: ActionContext.EXTENSION_VIEW,
        execute: () => reach('sms'),
      },
      {
        id: 'whatsapp',
        title: 'WhatsApp',
        description: 'Opens the chat for the highlighted number. Needs a number with a country code.',
        icon: '🟢',
        shortcut: '⇧⌥⏎',
        extensionId,
        category: ActionCategory.PRIMARY,
        context: ActionContext.EXTENSION_VIEW,
        execute: () => reach('whatsapp'),
      },
      {
        id: 'email',
        title: 'Write an email',
        icon: '✉️',
        shortcut: '⌥⌘⏎',
        extensionId,
        category: ActionCategory.PRIMARY,
        context: ActionContext.EXTENSION_VIEW,
        execute: () => reach('email'),
      },
      {
        id: 'copy-number',
        title: 'Copy the number',
        icon: '📋',
        shortcut: '⇧⏎',
        extensionId,
        category: ActionCategory.SHARE,
        context: ActionContext.EXTENSION_VIEW,
        execute: () => reach('copy'),
      },
      {
        id: 'copy-email',
        title: 'Copy the email address',
        icon: '📋',
        extensionId,
        category: ActionCategory.SHARE,
        context: ActionContext.EXTENSION_VIEW,
        execute: async () => {
          const address = selected?.emails[0]?.address;
          if (address === undefined) {
            showNotice('This contact has no email address.');
            return;
          }
          await copyToClipboard(address, `Copied ${address}.`);
        },
      },
      {
        id: 'open-in-contacts',
        title: 'Open in Contacts',
        icon: '📇',
        shortcut: '⇧⌘⏎',
        extensionId,
        category: ActionCategory.NAVIGATION,
        context: ActionContext.EXTENSION_VIEW,
        execute: () => openInContacts(),
      },
      {
        id: 'reload',
        title: 'Reload contacts',
        description: 'Discards the cache and reads the macOS address book again.',
        icon: '🔄',
        extensionId,
        category: ActionCategory.PRIMARY,
        context: ActionContext.EXTENSION_VIEW,
        execute: () => reload(),
      },
    ];

    let dropped = false;
    const drop = (): void => {
      if (dropped) return;
      dropped = true;
      for (const action of actions) context.unregisterAction(action.id);
    };

    for (const action of actions) context.registerAction(action);

    // `pagehide` covers the iframe being torn down on a view switch;
    // the returned cleanup covers an ordinary re-render of this effect.
    window.addEventListener('pagehide', drop);
    return () => {
      window.removeEventListener('pagehide', drop);
      drop();
    };
  });

  // ── Presentation helpers ──────────────────────────────────────────────
  function initials(contact: Contact): string {
    // Records whose only name is a phone number are common in a synced address
    // book. Two digits as "initials" reads as a mistake, so they get a glyph.
    const parts = contact.name.split(/[^\p{L}]+/u).filter(Boolean);
    if (parts.length === 0) return '☏';
    if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
    return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  }

  function subtitle(contact: Contact): string {
    if (contact.organization !== '' && contact.organization !== contact.name) {
      return contact.jobTitle !== ''
        ? `${contact.jobTitle} · ${contact.organization}`
        : contact.organization;
    }
    // Fall back to a way of reaching them — but never repeat the title, which
    // is what happened for contacts whose display name *is* their number.
    const fallback = contact.phones[0]?.display ?? contact.emails[0]?.address ?? '';
    return fallback === contact.name ? '' : fallback;
  }

  function freshness(at: number | null): string {
    if (at === null) return '';
    const minutes = Math.floor((Date.now() - at) / 60000);
    if (minutes < 1) return 'updated just now';
    if (minutes < 60) return `updated ${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `updated ${hours} h ago`;
    return `updated ${Math.floor(hours / 24)} d ago`;
  }

  // `boot()` owns its own error boundary, so this cannot become an unhandled
  // rejection — which is what the launcher was reporting as a bare
  // "<extensionId> promise was rejected".
  void boot();
</script>

<svelte:window onkeydown={handleDomKeydown} />

<main class="panel">
  {#if status === 'loading'}
    <div class="centered">
      <div class="spinner" aria-hidden="true"></div>
      <p class="lead">Reading contacts …</p>
      <p class="muted">The first run takes a few seconds.</p>
    </div>
  {:else if status === 'permissions'}
    <div class="centered">
      <p class="glyph" aria-hidden="true">🛡️</p>
      <p class="lead">This extension is waiting for your approval</p>
      <p class="muted">
        Asyar withholds every permission an extension declares until you have approved them
        once — including the ones that have nothing to do with the call that just failed.
      </p>
      <p class="muted steps">{statusDetail}</p>
      <div class="buttons">
        <button class="primary" onclick={() => boot()}>Try again</button>
      </div>
    </div>
  {:else if status === 'denied'}
    <div class="centered">
      <p class="glyph" aria-hidden="true">🔒</p>
      <p class="lead">Asyar has no access to your contacts</p>
      <p class="muted">{statusDetail}</p>
      <div class="buttons">
        <button class="primary" onclick={() => grantAccess()}>Request access</button>
        <button onclick={() => launch(SYSTEM_SETTINGS_CONTACTS, "Couldn't open System Settings.")}>
          Open System Settings
        </button>
      </div>
    </div>
  {:else if status === 'error'}
    <div class="centered">
      <p class="glyph" aria-hidden="true">⚠️</p>
      <p class="lead">The contacts could not be read</p>
      <p class="muted">{statusDetail}</p>
      <div class="buttons">
        <button class="primary" onclick={() => refresh(false)}>Try again</button>
      </div>
    </div>
  {:else}
    <div class="body">
      <div class="list" bind:this={containerEl}>
        {#if rows.length === 0}
          <p class="empty">No contact matches “{query}”.</p>
        {:else}
          {#each rows as contact (contact.id)}
            <button
              type="button"
              class="row"
              class:selected={contact.id === selectedId}
              data-contact-id={contact.id}
              onclick={() => (selectedId = contact.id)}
              ondblclick={() => reach(primaryAction)}
            >
              <span class="avatar" aria-hidden="true">{initials(contact)}</span>
              <span class="row-text">
                <span class="row-name">{contact.name}</span>
                {#if subtitle(contact) !== ''}
                  <span class="row-sub">{subtitle(contact)}</span>
                {/if}
              </span>
              {#if contact.phones.length > 0}
                <span class="row-badge" title="Phone numbers">
                  {contact.phones.length > 1 ? `📞 ${contact.phones.length}` : '📞'}
                </span>
              {/if}
            </button>
          {/each}
          {#if hiddenCount > 0}
            <p class="more">
              … and {hiddenCount} more. Keep typing to narrow the list.
            </p>
          {/if}
        {/if}
      </div>

      <aside class="detail">
        {#if selected === null}
          <p class="empty">No contact highlighted.</p>
        {:else}
          <div class="detail-head">
            {#if photo !== null}
              <img class="photo" src={`data:image/jpeg;base64,${photo}`} alt="" />
            {:else}
              <span class="photo placeholder" aria-hidden="true">{initials(selected)}</span>
            {/if}
            <p class="detail-name">{selected.name}</p>
            {#if selected.organization !== '' && selected.organization !== selected.name}
              <p class="muted">{selected.organization}</p>
            {/if}
          </div>

          {#if selected.phones.length > 0}
            <p class="section-label">Phone numbers</p>
            <ul class="values">
              {#each selected.phones as phone, index (phone.dial + index)}
                <li>
                  <button
                    type="button"
                    class="value"
                    class:active={index === Math.min(numberIndex, selected.phones.length - 1)}
                    onclick={() => {
                      numberIndex = index;
                      void reach('call');
                    }}
                  >
                    <span class="value-label">{phone.label}</span>
                    <span class="value-text">{phone.display}</span>
                  </button>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="muted">No phone number on file.</p>
          {/if}

          {#if selected.emails.length > 0}
            <p class="section-label">Email</p>
            <ul class="values">
              {#each selected.emails as mail, index (mail.address + index)}
                <li>
                  <button type="button" class="value" onclick={() => reach('email')}>
                    <span class="value-label">{mail.label}</span>
                    <span class="value-text">{mail.address}</span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        {/if}
      </aside>
    </div>

    <footer class="footer">
      <div class="hints">
        {#each SHORTCUT_HINTS as hint (hint.keys)}
          <span class="hint"><kbd>{hint.keys}</kbd>{hint.label}</span>
        {/each}
      </div>
      <div class="meta">
        {#if notice !== null}
          <span class="notice">{notice}</span>
        {:else}
          <span class="muted">
            {matched.length} of {contacts.length}
            {#if refreshing}· refreshing …{:else if indexedAt !== null}· {freshness(indexedAt)}{/if}
          </span>
        {/if}
      </div>
    </footer>
  {/if}
</main>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    height: 100vh;
    font-family: var(--font-ui);
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    background: var(--bg-primary);
  }

  .body {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  /* ── List ─────────────────────────────────────────────────────────── */
  .list {
    flex: 1 1 auto;
    min-width: 0;
    overflow-y: auto;
    padding: var(--space-2);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .row:hover {
    background: var(--bg-hover);
  }

  .row.selected {
    background: var(--bg-selected);
  }

  .avatar,
  .photo.placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    border-radius: var(--radius-full);
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    font-size: var(--font-size-2xs);
    font-weight: 600;
    letter-spacing: var(--tracking-wide);
  }

  .avatar {
    width: var(--size-md);
    height: var(--size-md);
  }

  .row-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  .row-name,
  .row-sub,
  .value-text,
  .detail-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-sub {
    color: var(--text-tertiary);
    font-size: var(--font-size-xs);
  }

  .row-badge {
    flex: 0 0 auto;
    color: var(--text-tertiary);
    font-size: var(--font-size-2xs);
  }

  .more,
  .empty {
    padding: var(--space-3);
    color: var(--text-tertiary);
    font-size: var(--font-size-xs);
  }

  /* ── Detail ───────────────────────────────────────────────────────── */
  .detail {
    flex: 0 0 15rem;
    min-width: 0;
    overflow-y: auto;
    padding: var(--space-4) var(--space-3);
    border-left: 1px solid var(--separator);
    background: var(--bg-secondary);
  }

  .detail-head {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    text-align: center;
    margin-bottom: var(--space-4);
  }

  .photo {
    width: var(--size-2xl);
    height: var(--size-2xl);
    border-radius: var(--radius-full);
    object-fit: cover;
    font-size: var(--font-size-md);
  }

  .detail-name {
    max-width: 100%;
    font-size: var(--font-size-md);
    font-weight: 600;
  }

  .section-label {
    margin: var(--space-3) 0 var(--space-1);
    color: var(--text-tertiary);
    font-size: var(--font-size-2xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
  }

  .values {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .value {
    display: flex;
    flex-direction: column;
    width: 100%;
    padding: var(--space-1-5) var(--space-2);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .value:hover {
    background: var(--bg-hover);
  }

  .value.active {
    border-color: var(--accent-primary);
    background: var(--accent-primary-fill);
  }

  .value-label {
    color: var(--text-tertiary);
    font-size: var(--font-size-2xs);
  }

  /* ── Footer ───────────────────────────────────────────────────────── */
  .footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex: 0 0 auto;
    padding: var(--space-2) var(--space-3);
    border-top: 1px solid var(--separator);
    background: var(--bg-secondary);
    font-size: var(--font-size-2xs);
  }

  .hints {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    color: var(--text-tertiary);
  }

  .hint {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    white-space: nowrap;
  }

  kbd {
    padding: 0 var(--space-1);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-xs);
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    font-family: var(--font-mono);
  }

  .meta {
    flex: 0 0 auto;
    text-align: right;
  }

  .notice {
    color: var(--accent-primary);
  }

  /* ── States ───────────────────────────────────────────────────────── */
  .centered {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-6);
    text-align: center;
  }

  .glyph {
    font-size: var(--font-size-2xl);
  }

  .lead {
    font-size: var(--font-size-md);
    font-weight: 600;
  }

  .muted {
    max-width: 32rem;
    color: var(--text-tertiary);
    font-size: var(--font-size-xs);
    line-height: 1.5;
  }

  .steps {
    color: var(--text-secondary);
  }

  .buttons {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  button.primary,
  .buttons button {
    padding: var(--space-1-5) var(--space-4);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    font: inherit;
    cursor: pointer;
  }

  button.primary {
    border-color: transparent;
    background: var(--accent-primary);
    color: var(--text-on-accent);
  }

  .spinner {
    width: var(--size-sm);
    height: var(--size-sm);
    border: 2px solid var(--border-color);
    border-top-color: var(--accent-primary);
    border-radius: var(--radius-full);
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: none;
    }
  }
</style>
