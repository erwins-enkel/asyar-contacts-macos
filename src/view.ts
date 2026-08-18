// ─────────────────────────────────────────────────────────────────────────
// view.ts — the view entry, loaded by dist/view.html.
//
// Bootstrap only; every decision the panel makes lives in ContactsView.svelte
// and the pure modules under src/contacts/, which is what lets those be unit
// tested without a launcher.
//
// `asyar-sdk/view` asserts `window.__ASYAR_ROLE__ === "view"` at module load.
// The Rust `asyar-extension://` scheme handler sets that global from the
// requested filename alone — renaming view.html breaks this import.
// ─────────────────────────────────────────────────────────────────────────

import 'asyar-sdk/tokens.css';
import { mount } from 'svelte';
import {
  ExtensionContext,
  extensionBridge,
  registerIconElement,
  type Extension,
  type IExtensionManager,
} from 'asyar-sdk/view';
import manifest from '../manifest.json';
import ContactsView from './ContactsView.svelte';

const FALLBACK_ID = 'blog.osthoff.contacts';

// Under the dev server the id is the first path segment; in the installed app
// the iframe hostname is the id.
const extensionId =
  window.location.hostname === 'localhost' ||
  window.location.hostname === 'asyar-extension.localhost'
    ? window.location.pathname.split('/').filter(Boolean)[0] || FALLBACK_ID
    : window.location.hostname || FALLBACK_ID;

class ContactsViewExtension implements Extension {
  private extensionManager?: IExtensionManager;

  async initialize(ctx: ExtensionContext): Promise<void> {
    this.extensionManager = ctx.getService<IExtensionManager>('extensions');
  }

  async activate(): Promise<void> {}

  async deactivate(): Promise<void> {}

  async executeCommand(commandId: string): Promise<unknown> {
    if (commandId !== 'contacts') return undefined;
    const viewPath = `${extensionId}/ContactsView`;
    this.extensionManager?.navigateToView(viewPath);
    return { type: 'view', viewPath };
  }
}

const context = new ExtensionContext();
context.setExtensionId(extensionId);
registerIconElement();

const viewExtension = new ContactsViewExtension();

// Order is load-bearing: registerExtensionImplementation() logs an error and
// silently returns when no manifest is registered for the id.
extensionBridge.registerManifest(
  manifest as Parameters<typeof extensionBridge.registerManifest>[0],
);
extensionBridge.registerExtensionImplementation(extensionId, viewExtension);

// Forward ⌘K so the action drawer opens while focus is inside this iframe.
window.addEventListener('keydown', (event) => {
  if (!((event.metaKey || event.ctrlKey) && event.key === 'k')) return;
  event.preventDefault();
  window.parent.postMessage(
    {
      type: 'asyar:extension:keydown',
      payload: {
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      },
    },
    '*',
  );
});

void (async () => {
  await viewExtension.initialize(context);
  await viewExtension.activate();
})();

const viewName = new URLSearchParams(window.location.search).get('view');
const target = document.getElementById('app');
if (viewName === 'ContactsView' && target) {
  mount(ContactsView, { target, props: { context, extensionId } });
}
