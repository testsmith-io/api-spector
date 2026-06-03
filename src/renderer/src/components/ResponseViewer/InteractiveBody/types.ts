// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { JsonPath } from './utils/jsonPath';

export type PopoverState =
  | { type: 'json'; path: JsonPath; value: unknown; root: unknown; x: number; y: number }
  | { type: 'xml';  selector: string; value: string; x: number; y: number }
