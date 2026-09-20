// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AttachmentPixelBadge } from '@/components/AttachmentPixelBadge'
import { rememberAttachmentPixels } from '@/lib/attachmentPixelCache'

// 读者看不到尺寸时，"这张会不会被服务端拒"只能靠撞墙 —— 所以量到了就必须显示出来。
describe('attachment pixel badge', () => {
  it('shows the pixel size once it has been measured', async () => {
    await rememberAttachmentPixels('badge-1:IMG_2696.JPG', new Blob(['x']), async () => ({
      width: 1179,
      height: 17728,
    }))
    const { container } = render(<AttachmentPixelBadge attachmentKey="badge-1:IMG_2696.JPG" />)
    expect(container.textContent).toBe('1179×17728')
  })

  // 量不到/未就绪 ⇒ 什么都不显示：不许出现 0×0、未知、转圈占位之类的噪音。
  it('renders nothing at all when the size is unknown', () => {
    const { container } = render(<AttachmentPixelBadge attachmentKey="badge-unknown:none.jpg" />)
    expect(container.textContent).toBe('')
    expect(container.innerHTML).toBe('')
    expect(container.textContent).not.toMatch(/0×0|未知|unknown|loading/i)
  })
})
