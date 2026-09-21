// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import AttachmentNotice from '@/components/AttachmentNotice'

afterEach(cleanup)

describe('compressed attachment notice', () => {
  it('shows the backend sentence when the attachment was compressed', () => {
    render(<AttachmentNotice chinese="这张照片已压缩到 8.2 MiB 才发得出去；原图在本地未改。" english="This photo was compressed to 8.2 MiB so it could be sent; your original file is unchanged." />)
    expect(screen.getByRole('note').textContent).toContain('已压缩')
    expect(screen.getByRole('note').textContent).toContain('原图在本地未改')
  })
  it('shows nothing for an attachment that was not compressed', () => {
    const { container } = render(<AttachmentNotice chinese={undefined} english={undefined} />)
    expect(container.innerHTML).toBe('')
    expect(screen.queryByRole('note')).toBeNull()
  })
})
