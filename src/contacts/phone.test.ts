import { describe, expect, it } from 'vitest';
import {
  addressBookUrl,
  mailUrl,
  normalizeDial,
  reachUrl,
  resolveDialPrefix,
  whatsappUrl,
} from './phone';

describe('resolveDialPrefix', () => {
  it('reads the Mac region when the preference is "auto"', () => {
    expect(resolveDialPrefix('auto', 'DE')).toBe('+49');
    expect(resolveDialPrefix('AUTO', 'us')).toBe('+1');
  });

  it('returns nothing for an unknown region, leaving numbers as stored', () => {
    expect(resolveDialPrefix('auto', 'ZZ')).toBe('');
    expect(resolveDialPrefix('auto', '')).toBe('');
  });

  it('accepts an explicit prefix however the user spells it', () => {
    expect(resolveDialPrefix('+49', 'US')).toBe('+49');
    expect(resolveDialPrefix('49', 'US')).toBe('+49');
    expect(resolveDialPrefix('0049', 'US')).toBe('+49');
    expect(resolveDialPrefix(' +49 ', 'US')).toBe('+49');
  });

  it('accepts a bare region code, since the field says "auto"', () => {
    expect(resolveDialPrefix('ch', 'DE')).toBe('+41');
  });

  it('treats an empty preference as "leave numbers alone"', () => {
    expect(resolveDialPrefix('', 'DE')).toBe('');
    expect(resolveDialPrefix('   ', 'DE')).toBe('');
  });
});

describe('normalizeDial', () => {
  it('strips formatting from an international number', () => {
    expect(normalizeDial('+49 151 1234567', '+49')).toBe('+491511234567');
    expect(normalizeDial('+1 (555) 123-4567', '+49')).toBe('+15551234567');
  });

  it('rewrites the 00 international prefix as +', () => {
    expect(normalizeDial('00497131123400', '+49')).toBe('+497131123400');
    expect(normalizeDial('0049 7131 123400', '')).toBe('+497131123400');
  });

  it('promotes a national number using the configured prefix', () => {
    expect(normalizeDial('0172/1234567', '+49')).toBe('+491721234567');
    expect(normalizeDial('07131/123456', '+49')).toBe('+497131123456');
  });

  it('leaves a national number alone when no prefix is configured', () => {
    expect(normalizeDial('0172/1234567', '')).toBe('01721234567');
  });

  it('never invents a country code for a number with no trunk digit', () => {
    // "5551234567" carries no evidence of which country it belongs to.
    // Prefixing it would dial a different subscriber.
    expect(normalizeDial('555 123 4567', '+49')).toBe('5551234567');
  });

  it('reports nothing dialable rather than an empty-ish string', () => {
    expect(normalizeDial('', '+49')).toBe('');
    expect(normalizeDial('   ', '+49')).toBe('');
    expect(normalizeDial('n/a', '+49')).toBe('');
  });
});

describe('reachUrl', () => {
  it('maps each action to its macOS scheme', () => {
    expect(reachUrl('call', '+491721234567')).toBe('tel:+491721234567');
    expect(reachUrl('facetime', '+491721234567')).toBe('facetime:+491721234567');
    expect(reachUrl('facetime-audio', '+491721234567')).toBe('facetime-audio:+491721234567');
    expect(reachUrl('sms', '+491721234567')).toBe('sms:+491721234567');
  });

  it('keeps the leading + intact through encoding', () => {
    expect(reachUrl('call', '+49 172')).toBe('tel:+49%20172');
  });

  it('sends WhatsApp bare E.164 digits, without the plus', () => {
    // Verified against the app: passing "490000000000" made WhatsApp report
    // "+490000000000 ist nicht bei WhatsApp registriert" (German, the app is
    // localised: "is not registered on WhatsApp"). It re-adds the plus itself,
    // so sending one would double it.
    expect(reachUrl('whatsapp', '+491701112223')).toBe(
      'whatsapp://send?phone=491701112223',
    );
  });

  it('refuses WhatsApp for a number with no country code', () => {
    // "01701112223" would be read as "+01631…" — a different subscriber in a
    // country that does not exist. Better no URL than the wrong chat.
    expect(reachUrl('whatsapp', '01701112223')).toBeNull();
    expect(whatsappUrl('01701112223')).toBeNull();
    expect(whatsappUrl('+')).toBeNull();
    expect(whatsappUrl('')).toBeNull();
  });

  it('has no URL for the clipboard and email actions', () => {
    expect(reachUrl('copy', '+49172')).toBeNull();
    expect(reachUrl('email', '+49172')).toBeNull();
  });

  it('refuses an empty number', () => {
    expect(reachUrl('call', '')).toBeNull();
  });
});

describe('mailUrl / addressBookUrl', () => {
  it('builds a bare mailto', () => {
    expect(mailUrl('kai@osthoff.blog')).toBe('mailto:kai%40osthoff.blog');
    expect(mailUrl('  ')).toBeNull();
  });

  it('builds an addressbook URL from the Contacts identifier, unencoded', () => {
    expect(addressBookUrl('4E7C77B8-3FC5-4C68-9620-A1B24ECF6A51:ABPerson')).toBe(
      'addressbook://4E7C77B8-3FC5-4C68-9620-A1B24ECF6A51:ABPerson',
    );
  });

  it('refuses anything that is not a plain Contacts identifier', () => {
    expect(addressBookUrl('')).toBeNull();
    expect(addressBookUrl('../../etc/passwd')).toBeNull();
    expect(addressBookUrl('id with spaces')).toBeNull();
  });
});
