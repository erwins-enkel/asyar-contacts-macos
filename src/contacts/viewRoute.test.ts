import { describe, expect, it } from 'vitest';
import { parseViewRoute } from './viewRoute';

describe('parseViewRoute', () => {
  it('reads a plain component, as the command path produces it', () => {
    expect(parseViewRoute('?view=ContactsView')).toEqual({
      component: 'ContactsView',
      selection: null,
    });
  });

  it('reads the contact a root-search row asked for', () => {
    expect(parseViewRoute('?view=ContactsView%3Fid%3DAB-12%3AABPerson')).toEqual({
      component: 'ContactsView',
      selection: 'AB-12:ABPerson',
    });
  });

  it('survives the launcher pasting the path in unencoded', () => {
    // ExtensionIframe builds `?view=${view.split('/')[1]}` with no encoding of
    // its own, so the second `?` arrives literally.
    expect(parseViewRoute('?view=ContactsView?id=AB-12%3AABPerson')).toEqual({
      component: 'ContactsView',
      selection: 'AB-12:ABPerson',
    });
  });

  it('treats an empty identifier as no selection', () => {
    expect(parseViewRoute('?view=ContactsView?id=')).toEqual({
      component: 'ContactsView',
      selection: null,
    });
  });

  it('reports the component even when it is one we do not have', () => {
    expect(parseViewRoute('?view=DefaultView')).toEqual({
      component: 'DefaultView',
      selection: null,
    });
  });

  it('answers for a missing parameter rather than throwing', () => {
    expect(parseViewRoute('')).toEqual({ component: '', selection: null });
  });
});
