/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import React, { useCallback } from 'react';
import {
  EuiButtonEmpty,
  EuiDescriptionList,
  EuiFlexGroup,
  EuiFlexItem,
  EuiPopover,
  EuiSpacer,
  EuiText,
  EuiTitle,
  EuiCopy,
  EuiButtonIcon,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import type { ExemplarClickData } from '../../common/exemplars';

export interface ExemplarPopoverProps {
  data: ExemplarClickData;
  anchor: React.ReactNode;
  onClose: () => void;
  onOpenTraceFlyout?: (traceId: string) => void;
  onOpenInAPM?: (traceId: string) => void;
}

export const ExemplarPopover = ({
  data,
  anchor,
  onClose,
  onOpenTraceFlyout,
  onOpenInAPM,
}: ExemplarPopoverProps) => {
  const handleSeeTrace = useCallback(() => {
    onOpenTraceFlyout?.(data.traceId);
    onClose();
  }, [data.traceId, onOpenTraceFlyout, onClose]);

  const handleOpenInAPM = useCallback(() => {
    onOpenInAPM?.(data.traceId);
    onClose();
  }, [data.traceId, onOpenInAPM, onClose]);

  const labelItems = Object.entries(data.labels).map(([key, value]) => ({
    title: key,
    description: value,
  }));

  if (data.spanId) {
    labelItems.unshift({ title: 'span.id', description: data.spanId });
  }

  return (
    <EuiPopover
      button={anchor ?? <span />}
      isOpen={true}
      closePopover={onClose}
      anchorPosition="upCenter"
      panelPaddingSize="m"
      data-test-subj="exemplarPopover"
    >
      <EuiTitle size="xs">
        <h3>
          {i18n.translate('metricsExperience.exemplarPopover.title', {
            defaultMessage: 'Related trace',
          })}
        </h3>
      </EuiTitle>
      <EuiText size="xs" color="subdued">
        {i18n.translate('metricsExperience.exemplarPopover.sampledNotice', {
          defaultMessage: 'Sampled — not causally linked to this bucket.',
        })}
      </EuiText>

      <EuiSpacer size="s" />

      <EuiFlexGroup gutterSize="xs" alignItems="center" responsive={false}>
        <EuiFlexItem grow={false}>
          <EuiText size="s">
            <strong>trace.id</strong>
          </EuiText>
        </EuiFlexItem>
        <EuiFlexItem>
          <EuiText size="s">
            <code data-test-subj="exemplarPopoverTraceId">{data.traceId}</code>
          </EuiText>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiCopy textToCopy={data.traceId}>
            {(copy) => (
              <EuiButtonIcon
                iconType="copy"
                size="xs"
                aria-label={i18n.translate('metricsExperience.exemplarPopover.copyTraceId', {
                  defaultMessage: 'Copy trace ID',
                })}
                onClick={copy}
              />
            )}
          </EuiCopy>
        </EuiFlexItem>
      </EuiFlexGroup>

      {data.durationMs !== undefined && (
        <>
          <EuiSpacer size="xs" />
          <EuiText size="s">
            <strong>
              {i18n.translate('metricsExperience.exemplarPopover.duration', {
                defaultMessage: 'Duration',
              })}
            </strong>{' '}
            {data.durationMs.toFixed(2)} ms
          </EuiText>
        </>
      )}

      {data.timestamp !== undefined && (
        <>
          <EuiSpacer size="xs" />
          <EuiText size="s">
            <strong>
              {i18n.translate('metricsExperience.exemplarPopover.timestamp', {
                defaultMessage: 'Timestamp',
              })}
            </strong>{' '}
            {new Date(data.timestamp).toLocaleString()}
          </EuiText>
        </>
      )}

      {labelItems.length > 0 && (
        <>
          <EuiSpacer size="s" />
          <EuiDescriptionList
            type="column"
            columnWidths={[1, 2]}
            listItems={labelItems}
            compressed
          />
        </>
      )}

      <EuiSpacer size="m" />

      <EuiFlexGroup gutterSize="s" responsive={false} justifyContent="flexEnd">
        {onOpenInAPM && (
          <EuiFlexItem grow={false}>
            <EuiButtonEmpty
              size="s"
              iconType="popout"
              onClick={handleOpenInAPM}
              data-test-subj="exemplarPopoverOpenInAPM"
            >
              {i18n.translate('metricsExperience.exemplarPopover.openInAPM', {
                defaultMessage: 'Open in APM',
              })}
            </EuiButtonEmpty>
          </EuiFlexItem>
        )}
        {onOpenTraceFlyout && (
          <EuiFlexItem grow={false}>
            <EuiButtonEmpty
              size="s"
              iconType="inspect"
              onClick={handleSeeTrace}
              data-test-subj="exemplarPopoverSeeTrace"
            >
              {i18n.translate('metricsExperience.exemplarPopover.seeTrace', {
                defaultMessage: 'See trace',
              })}
            </EuiButtonEmpty>
          </EuiFlexItem>
        )}
      </EuiFlexGroup>
    </EuiPopover>
  );
};
