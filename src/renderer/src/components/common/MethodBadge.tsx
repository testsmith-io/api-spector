// Copyright (C) 2026  Testsmith.io <https://testsmith.io>
//
// This file is part of api Spector.
//
// api Spector is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, version 3.
//
// api Spector is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with api Spector.  If not, see <https://www.gnu.org/licenses/>.

import React from 'react';
import { getMethodColor } from '../../../../shared/colors';

export function MethodBadge({ method, size = 'sm' }: { method: string; size?: 'sm' | 'xs' }) {
  const color = getMethodColor(method);
  const cls = size === 'xs' ? 'text-[10px] font-bold w-10' : 'text-xs font-bold w-12';
  return <span className={`${cls} ${color} shrink-0`}>{method}</span>;
}
