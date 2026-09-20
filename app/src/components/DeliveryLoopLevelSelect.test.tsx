// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeliveryLoopLevelSelect } from '@/components/DeliveryLoopLevelSelect'
import { normalizeDeliveryLoopLevel, withDeliveryLoopLevel } from '@/lib/deliveryLoopLevel'

afterEach(cleanup)

describe('delivery loop level', () => {
  // 界面必须能选三档（用户要求：严格 / 标准 / 宽松）。
  it('offers exactly the three levels, and no way to switch the breaker off', () => {
    render(<DeliveryLoopLevelSelect value="standard" onChange={() => {}} />)
    const options = screen.getAllByRole('radio')
    expect(options).toHaveLength(3)
    expect(options.map(option => option.textContent)).toEqual(['严格', '标准', '宽松'])
    expect(screen.queryByText(/关闭|off/i)).toBeNull()
    expect(screen.getByRole('radio', { name: '标准' }).getAttribute('aria-checked')).toBe('true')
  })

  // 非法/缺失的值必须显示为"标准"，不能显示成"没在防护"。
  it('shows standard for a missing or unknown value', () => {
    const { unmount } = render(<DeliveryLoopLevelSelect value={undefined} onChange={() => {}} />)
    expect(screen.getByRole('radio', { name: '标准' }).getAttribute('aria-checked')).toBe('true')
    unmount()
    render(<DeliveryLoopLevelSelect value="off" onChange={() => {}} />)
    expect(screen.getByRole('radio', { name: '标准' }).getAttribute('aria-checked')).toBe('true')
  })

  it('reports the chosen level', () => {
    const onChange = vi.fn()
    render(<DeliveryLoopLevelSelect value="standard" onChange={onChange} />)
    fireEvent.click(screen.getByRole('radio', { name: '严格' }))
    expect(onChange).toHaveBeenCalledWith('strict')
  })

  it('normalizes like the backend does', () => {
    expect(normalizeDeliveryLoopLevel('strict')).toBe('strict')
    expect(normalizeDeliveryLoopLevel('  LOOSE ')).toBe('loose')
    expect(normalizeDeliveryLoopLevel('')).toBe('standard')
    expect(normalizeDeliveryLoopLevel(undefined)).toBe('standard')
    expect(normalizeDeliveryLoopLevel('off')).toBe('standard')
    expect(normalizeDeliveryLoopLevel('nonsense')).toBe('standard')
  })

  // 标准档不写这个键：默认配置的文件保持原样（与后端 omitempty 一致）。
  it('keeps other collaboration fields and omits the default level', () => {
    const base = { allow_cross_conversation: true, allow_by_conversation: { a: ['b'] } }
    expect(withDeliveryLoopLevel(base, 'strict')).toEqual({ ...base, loop_level: 'strict' })
    expect(withDeliveryLoopLevel(base, 'standard')).toEqual(base)
    expect(withDeliveryLoopLevel(undefined, 'loose')).toEqual({ loop_level: 'loose' })
  })
})
