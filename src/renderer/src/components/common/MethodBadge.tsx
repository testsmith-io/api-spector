import React from 'react'
import { getMethodColor } from '../../../../shared/colors'

export function MethodBadge({ method, size = 'sm' }: { method: string; size?: 'sm' | 'xs' }) {
  const color = getMethodColor(method)
  const cls = size === 'xs' ? 'text-[10px] font-bold w-10' : 'text-xs font-bold w-12'
  return <span className={`${cls} ${color} shrink-0`}>{method}</span>
}
