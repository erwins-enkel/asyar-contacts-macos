import { describe, expect, it } from 'vitest';
import { intentFor } from './keys';

describe('intentFor', () => {
  it('walks the list with the vertical arrows', () => {
    expect(intentFor({ key: 'ArrowDown' }, 'call')).toEqual({ kind: 'move', direction: 'down' });
    expect(intentFor({ key: 'ArrowUp' }, 'call')).toEqual({ kind: 'move', direction: 'up' });
  });

  it('walks the highlighted contact’s own numbers with the horizontal arrows', () => {
    expect(intentFor({ key: 'ArrowRight' }, 'call')).toEqual({
      kind: 'cycle-number',
      direction: 'next',
    });
    expect(intentFor({ key: 'ArrowLeft' }, 'call')).toEqual({
      kind: 'cycle-number',
      direction: 'previous',
    });
  });

  it('runs the user’s chosen primary action on a bare Enter', () => {
    expect(intentFor({ key: 'Enter' }, 'call')).toEqual({ kind: 'reach', action: 'call' });
    expect(intentFor({ key: 'Enter' }, 'facetime-audio')).toEqual({
      kind: 'reach',
      action: 'facetime-audio',
    });
  });

  it('maps each Enter modifier to its own way of reaching the contact', () => {
    expect(intentFor({ key: 'Enter', metaKey: true }, 'call')).toEqual({
      kind: 'reach',
      action: 'facetime',
    });
    expect(intentFor({ key: 'Enter', altKey: true }, 'call')).toEqual({
      kind: 'reach',
      action: 'sms',
    });
    expect(intentFor({ key: 'Enter', shiftKey: true }, 'call')).toEqual({
      kind: 'reach',
      action: 'copy',
    });
    expect(intentFor({ key: 'Enter', metaKey: true, altKey: true }, 'call')).toEqual({
      kind: 'reach',
      action: 'email',
    });
    expect(intentFor({ key: 'Enter', metaKey: true, shiftKey: true }, 'call')).toEqual({
      kind: 'open-in-contacts',
    });
    expect(intentFor({ key: 'Enter', shiftKey: true, altKey: true }, 'call')).toEqual({
      kind: 'reach',
      action: 'whatsapp',
    });
  });

  it('catches ⇧⌥⏎ before the bare ⌥ branch, so WhatsApp is not Messages', () => {
    // These two overlap on altKey; order in the switch is what separates them.
    expect(intentFor({ key: 'Enter', altKey: true }, 'call')).toEqual({
      kind: 'reach',
      action: 'sms',
    });
    expect(intentFor({ key: 'Enter', altKey: true, shiftKey: true }, 'call')).toEqual({
      kind: 'reach',
      action: 'whatsapp',
    });
  });

  it('treats Ctrl as Cmd, so an external keyboard is not a dead end', () => {
    expect(intentFor({ key: 'Enter', ctrlKey: true }, 'call')).toEqual({
      kind: 'reach',
      action: 'facetime',
    });
  });

  it('ignores keys the launcher does not forward', () => {
    expect(intentFor({ key: 'c', metaKey: true }, 'call')).toBeNull();
    expect(intentFor({ key: 'Escape' }, 'call')).toBeNull();
    expect(intentFor({ key: 'Tab' }, 'call')).toBeNull();
  });
});
