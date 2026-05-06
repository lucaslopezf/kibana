/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { CoreSetup } from '@kbn/core/server';
import type { AgentBuilderPluginSetup } from '@kbn/agent-builder-plugin/server';
import { discoverOpenViewTool } from './tools/discover_open_view';

export const registerTools = (
  agentBuilder: AgentBuilderPluginSetup,
  coreSetup: CoreSetup
): void => {
  agentBuilder.tools.register(discoverOpenViewTool(coreSetup));
};
