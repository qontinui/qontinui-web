/**
 * UI Bridge Relay Setup
 *
 * Instantiates the SDK's CommandRelay and creates handlers backed by it.
 * This replaces ~4000 lines of custom relay code with ~10 lines of SDK usage.
 */

import { CommandRelay, createRelayHandlers } from '@qontinui/ui-bridge/server';

export const relay = new CommandRelay();
export const handlers = createRelayHandlers(relay, { version: '0.1.0' });
