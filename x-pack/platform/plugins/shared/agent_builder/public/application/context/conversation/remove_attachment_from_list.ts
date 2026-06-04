/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ConversationAttachment } from '@kbn/agent-builder-common/attachments';

/**
 * Removes the attachment whose `id` matches `attachmentId`.
 *
 * Filtering by id (and not by positional index) keeps the chip-removal action
 * correct when the parent renders a filtered view of `attachments` (e.g. it
 * hides screen-context attachments) but operates the removal against the full,
 * unfiltered list — otherwise the indices misalign and the wrong attachment
 * is removed.
 *
 * No-op when no attachment has the given id; returns a new array (input is not
 * mutated).
 */
export const removeAttachmentFromList = (
  attachments: ConversationAttachment[],
  attachmentId: string
): ConversationAttachment[] => attachments.filter((attachment) => attachment.id !== attachmentId);
