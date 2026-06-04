/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import type {
  ConversationAttachment,
  AttachmentGroup,
} from '@kbn/agent-builder-common/attachments';
import { AttachmentPillsRow } from './attachment_pills_row';
import { useConversationContext } from '../../../context/conversation/conversation_context';
import { AttachmentGroupPill } from './attachment_group_pill';

jest.mock('../../../context/conversation/conversation_context', () => ({
  useConversationContext: jest.fn(),
}));

jest.mock('./attachment_pill', () => ({
  AttachmentPill: ({
    attachment,
    onRemoveAttachment,
  }: {
    attachment: { id: string };
    onRemoveAttachment?: () => void;
  }) => (
    <div data-test-subj={`mock-attachment-pill-${attachment.id}`}>
      {onRemoveAttachment ? (
        <button
          type="button"
          data-test-subj={`mock-attachment-pill-${attachment.id}-remove`}
          onClick={onRemoveAttachment}
        >
          remove
        </button>
      ) : null}
    </div>
  ),
}));

jest.mock('./attachment_group_pill', () => ({
  AttachmentGroupPill: jest.fn(() => null),
}));

const mockUseConversationContext = jest.mocked(useConversationContext);
const MockAttachmentGroupPill = jest.mocked(AttachmentGroupPill);

const makeGroup = (id: string): AttachmentGroup => ({
  type: 'group',
  id,
  label: '2 Alerts',
  items: [],
});

const makeInput = (id: string): ConversationAttachment => ({
  id,
  type: 'text',
  data: {},
});

describe('AttachmentPillsRow', () => {
  const mockRemoveAttachment = jest.fn();

  beforeEach(() => {
    mockRemoveAttachment.mockReset();
    MockAttachmentGroupPill.mockReset();
    MockAttachmentGroupPill.mockReturnValue(null);
    mockUseConversationContext.mockReturnValue({
      removeAttachment: mockRemoveAttachment,
      isEmbeddedContext: false,
      conversationActions: {} as never,
    });
  });

  it('renders nothing when the attachments list is empty', () => {
    const { container } = render(<AttachmentPillsRow attachments={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders AttachmentGroupPill for an AttachmentGroup', () => {
    render(<AttachmentPillsRow attachments={[makeGroup('g1')]} />);
    expect(MockAttachmentGroupPill).toHaveBeenCalledTimes(1);
    expect(MockAttachmentGroupPill.mock.calls[0][0].group.id).toBe('g1');
  });

  it('renders AttachmentPill for an AttachmentInput (no group pill)', () => {
    render(<AttachmentPillsRow attachments={[makeInput('a1')]} />);
    expect(MockAttachmentGroupPill).not.toHaveBeenCalled();
    expect(screen.getByTestId('mock-attachment-pill-a1')).toBeInTheDocument();
  });

  it('dispatches group pill for groups and regular pill for individuals in a mixed list', () => {
    render(
      <AttachmentPillsRow attachments={[makeInput('a1'), makeGroup('g1'), makeInput('a2')]} />
    );
    expect(screen.getByTestId('mock-attachment-pill-a1')).toBeInTheDocument();
    expect(screen.getByTestId('mock-attachment-pill-a2')).toBeInTheDocument();
    expect(MockAttachmentGroupPill).toHaveBeenCalledTimes(1);
    expect(MockAttachmentGroupPill.mock.calls[0][0].group.id).toBe('g1');
  });

  it('passes an onRemove callback to AttachmentGroupPill that removes by group id', () => {
    render(<AttachmentPillsRow attachments={[makeGroup('g1')]} removable />);
    const { onRemove } = MockAttachmentGroupPill.mock.calls[0][0];
    expect(onRemove).toBeDefined();
    if (onRemove) onRemove();
    expect(mockRemoveAttachment).toHaveBeenCalledWith('g1');
  });

  it('does not pass an onRemove callback to AttachmentGroupPill when removable is false', () => {
    render(<AttachmentPillsRow attachments={[makeGroup('g1')]} removable={false} />);
    const { onRemove } = MockAttachmentGroupPill.mock.calls[0][0];
    expect(onRemove).toBeUndefined();
  });

  it('removes a regular pill by its own id regardless of its position in the list', () => {
    // Putting `a2` after `a1` means an index-based removal of the visible
    // entry at position 1 would (incorrectly) target `a1` once the parent
    // strips hidden attachments. Removing by id keeps the click on the right
    // pill no matter where it sits in the rendered list.
    render(<AttachmentPillsRow attachments={[makeInput('a1'), makeInput('a2')]} removable />);

    screen.getByTestId('mock-attachment-pill-a2-remove').click();

    expect(mockRemoveAttachment).toHaveBeenCalledTimes(1);
    expect(mockRemoveAttachment).toHaveBeenCalledWith('a2');
  });

  it('does not render a remove button on a pill without an id', () => {
    const idless: ConversationAttachment = { type: 'text', data: {} };
    // Render alongside an id-bearing attachment so the test asserts both
    // cases in a single mount.
    render(<AttachmentPillsRow attachments={[idless, makeInput('a1')]} removable />);

    expect(screen.getByTestId('mock-attachment-pill-a1-remove')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-attachment-pill-text-0-remove')).not.toBeInTheDocument();
  });
});
