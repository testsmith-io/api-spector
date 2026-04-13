// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import type { JsonPath } from './utils/jsonPath';

export type PopoverState =
  | { type: 'json'; path: JsonPath; value: unknown; root: unknown; x: number; y: number }
  | { type: 'xml';  selector: string; value: string; x: number; y: number }
