/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { Attachment } from '@kbn/agent-builder-common/attachments';
import type { AgentBuilderPluginStart } from '@kbn/agent-builder-browser';
import type { AttachmentUIDefinition } from '@kbn/agent-builder-browser/attachments';
import { ESQL_QUERY_RESULTS_ATTACHMENT_TYPE } from '../../common/agent_builder';
import { registerEsqlResultsAttachmentUi } from './register_esql_results_ui';

const createAttachment = (data: Record<string, unknown>): Attachment =>
  ({
    id: 'attachment-1',
    type: ESQL_QUERY_RESULTS_ATTACHMENT_TYPE,
    data,
  } as unknown as Attachment);

describe('registerEsqlResultsAttachmentUi', () => {
  let addAttachmentType: jest.Mock;
  let uiDefinition: AttachmentUIDefinition<Attachment>;

  beforeEach(() => {
    addAttachmentType = jest.fn();
    const agentBuilder = {
      attachments: { addAttachmentType },
    } as unknown as AgentBuilderPluginStart;

    registerEsqlResultsAttachmentUi(agentBuilder);
    uiDefinition = addAttachmentType.mock.calls[0][1];
  });

  it('registers the ES|QL results attachment type with the expected hooks', () => {
    expect(addAttachmentType).toHaveBeenCalledWith(
      ESQL_QUERY_RESULTS_ATTACHMENT_TYPE,
      expect.objectContaining({
        getLabel: expect.any(Function),
        getIcon: expect.any(Function),
      })
    );
  });

  describe('getLabel', () => {
    it('uses data.title verbatim when present', () => {
      const label = uiDefinition.getLabel(
        createAttachment({
          title: 'system.cpu.user.pct by host.name',
          query: 'TS metrics-* | STATS avg(system.cpu.user.pct) BY host.name',
        })
      );

      expect(label).toBe('system.cpu.user.pct by host.name');
    });

    it('falls back to the ES|QL results label using the query when no title is set', () => {
      const label = uiDefinition.getLabel(
        createAttachment({ query: 'FROM logs-* | LIMIT 10' })
      );

      expect(label).toBe('ES|QL results: FROM logs-* | LIMIT 10');
    });

    it('truncates long queries in the fallback label', () => {
      const longQuery = 'FROM logs-* | ' + 'X'.repeat(200);

      const label = uiDefinition.getLabel(createAttachment({ query: longQuery }));

      expect(label.startsWith('ES|QL results: ')).toBe(true);
      // 60-character truncation + "..."
      expect(label.endsWith('...')).toBe(true);
      expect(label.length).toBeLessThan(longQuery.length);
    });

    it('returns the default label when neither title nor query are present', () => {
      const label = uiDefinition.getLabel(createAttachment({}));

      expect(label).toBe('ES|QL query results');
    });
  });

  describe('getIcon', () => {
    it('returns the visTable icon', () => {
      expect(uiDefinition.getIcon!(createAttachment({}))).toBe('visTable');
    });
  });
});
