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

/** Tailwind text-color class per HTTP method. */
export const METHOD_COLORS: Record<string, string> = {
  GET:     'text-emerald-400',
  POST:    'text-blue-400',
  PUT:     'text-amber-400',
  PATCH:   'text-orange-400',
  DELETE:  'text-red-400',
  HEAD:    'text-purple-400',
  OPTIONS: 'text-surface-400',
  ANY:     'text-surface-400',
};

export function getMethodColor(method: string): string {
  return METHOD_COLORS[method] ?? 'text-surface-400';
}

/** Tailwind text-color class per HTTP status code (first digit). */
export const STATUS_COLORS: Record<string, string> = {
  '2': 'text-emerald-400',
  '3': 'text-amber-400',
  '4': 'text-orange-400',
  '5': 'text-red-400',
};

export function getStatusColor(status: number): string {
  return STATUS_COLORS[String(status)[0]] ?? 'text-gray-400';
}
