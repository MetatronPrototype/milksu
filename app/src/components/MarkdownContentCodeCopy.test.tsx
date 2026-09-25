// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MarkdownContent from '@/components/MarkdownContent'

afterEach(cleanup)

// 读者反馈过：点代码块的「复制」，粘到终端里连左侧的行号一起带走了（命令被数字污染）。
// 修复是「只取 .agent-code__src 的文本」，这条用例把它守住。
// 注意：先断言代码块**确实带行号**，否则下面「复制里没有行号」会变成空断言（假绿）。
describe('代码块复制', () => {
  it('只复制代码正文，不带行号', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    render(<MarkdownContent content={'```bash\nnpm run test\nnpm run lint\n```'} />)

    // 前提：渲染出来的代码块确实带行号列（去掉这个前提，断言就没有意义了）。
    const lineNumbers = document.querySelectorAll('.agent-code__n')
    expect(lineNumbers.length, '代码块应带行号列，否则这条测试守不住任何东西').toBeGreaterThan(0)
    expect([...lineNumbers].map(cell => cell.textContent).join('')).toMatch(/1/)

    const copyButton = await screen.findByText(/^(复制|Copy)$/)
    copyButton.click()

    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const copied = String(writeText.mock.calls[0][0])

    // 精确断言：复制结果必须**完全等于**那两行代码。
    // （弱断言栽过：旧写法下 textContent 是「1npm run test」这种粘在一起的，
    //   用「行号单独成行」之类正则根本抓不到 ⇒ 假绿。这里直接钉死内容。）
    expect(copied).toBe('npm run test\nnpm run lint')

    // 再补一条：任何一行都不许以数字开头（行号可能贴上来）。
    for (const line of copied.split('\n')) {
      expect(line, `这一行前面多了行号：${line}`).not.toMatch(/^\s*\d/)
    }
  })
})
