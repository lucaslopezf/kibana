/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { AttachmentInput, AttachmentGroup } from '@kbn/agent-builder-common/attachments';
import { removeAttachmentFromList } from './remove_attachment_from_list';

const attachment = (id: string | undefined): AttachmentInput => ({
  id,
  type: 'visualization',
  data: {},
});

const group = (id: string): AttachmentGroup => ({
  type: 'group',
  id,
  label: '3 Alerts',
  items: [attachment('a'), attachment('b'), attachment('c')],
});

describe('removeAttachmentFromList', () => {
  it('removes the attachment with the given id', () => {
    const list = [attachment('a'), attachment('b'), attachment('c')];
    expect(removeAttachmentFromList(list, 'b')).toEqual([attachment('a'), attachment('c')]);
  });

  it('removes an AttachmentGroup with the given id', () => {
    const g = group('g1');
    const list = [attachment('a'), g, attachment('c')];
    expect(removeAttachmentFromList(list, 'g1')).toEqual([attachment('a'), attachment('c')]);
  });

  it('removes the first item by id', () => {
    const list = [attachment('a'), attachment('b'), attachment('c')];
    expect(removeAttachmentFromList(list, 'a')).toEqual([attachment('b'), attachment('c')]);
  });

  it('removes the last item by id', () => {
    const list = [attachment('a'), attachment('b'), attachment('c')];
    expect(removeAttachmentFromList(list, 'c')).toEqual([attachment('a'), attachment('b')]);
  });

  it('returns all items unchanged when no attachment has the given id', () => {
    const list = [attachment('a'), attachment('b')];
    expect(removeAttachmentFromList(list, 'missing')).toEqual(list);
  });

  it('ignores attachments without an id (they are never removable)', () => {
    const list = [attachment(undefined), attachment('b')];
    expect(removeAttachmentFromList(list, 'b')).toEqual([attachment(undefined)]);
  });

  it('does not mutate the input array', () => {
    const list = [attachment('a'), attachment('b')];
    const snapshot = JSON.stringify(list);
    removeAttachmentFromList(list, 'a');
    expect(JSON.stringify(list)).toBe(snapshot);
  });
});
