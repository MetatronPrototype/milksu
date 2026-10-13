// R4 交付 3：Computer Use 权限向导三态判别（CU v2 §3.8，audit D6）。
//
// 背景（2026-10-12 实测）：用户已在系统设置里授权，但屏幕录制列表 17 项里没有
// MilkSU/CuaDriver（adhoc 签名 CDHash 漂移 ⇒ macOS 不复用 TCC 授权），驱动守卫只会报
// 「请先授予辅助功能与屏幕录制」，分不清「没授权」与「授权没注册上」，用户跨 20 小时
// 四轮被拦，最后靠系统设置手动添加才通。
//
// 三态（判据：驱动 status 的 accessibility/screenRecording 布尔 = canary）：
//   ① ungranted 未授权 → 引导去系统设置授权；
//   ② drift 授权了没注册上（TCC 漂移）→ 指引「系统设置手动添加 MilkSU 后重启」；
//   ③ granted 已生效 → 不打扰。
//
// 「系统设置里是否真的显示已授权」无法直读（TCC 查询受限，§3.8-4）⇒ 问答式兜底：
// 打开过系统设置、轮询等待超过阈值仍未生效（时间侧），或用户直接确认「我已开启」
// （用户侧）⇒ 进入 drift 态。深度向导（自动检测+自动重试循环）是 P3 批次的事。

import { t } from '@/lib/uiLocale'
import type {
  CodingComputerUsePermission,
  CodingComputerUseSigning,
} from '@/codingEnvironmentTypes'

/** 打开系统设置后，轮询等待多久仍未生效就提示「授权可能没注册上」。 */
export const PERMISSION_DRIFT_HINT_MS = 90_000

export type PermissionWizardState = 'ungranted' | 'drift' | 'granted'

/**
 * 单项权限的三态判别（纯函数）。
 * - granted=true ⇒ 已生效；
 * - 用户确认「我已开启，仍未生效」⇒ 直接 drift（问答式，§3.8-4）；
 * - 打开过系统设置且等待 ≥ driftHintMs 仍未生效 ⇒ drift（时间侧兜底）；
 * - 其余 ⇒ ungranted。
 */
export function permissionWizardState(input: {
  granted: boolean
  /** 打开系统设置的时刻（epoch ms）；null=还没打开过。 */
  settingsOpenedAt: number | null
  /** 读者明确说「我已开启但没生效」。 */
  userConfirmedNotEffective?: boolean
  now: number
  driftHintMs?: number
}): PermissionWizardState {
  if (input.granted) return 'granted'
  if (input.userConfirmedNotEffective) return 'drift'
  if (input.settingsOpenedAt == null) return 'ungranted'
  return input.now - input.settingsOpenedAt >= (input.driftHintMs ?? PERMISSION_DRIFT_HINT_MS)
    ? 'drift'
    : 'ungranted'
}

/** 漂移态指引文案：手动添加步骤 + 签名身份对号入座 + 重启提示（D6 唯一走通的路径）。 */
export function permissionDriftGuidance(
  permission: CodingComputerUsePermission,
  signing?: CodingComputerUseSigning | null,
): string {
  const pane = permission === 'accessibility'
    ? t('辅助功能', 'Accessibility')
    : t('屏幕录制', 'Screen Recording')
  const identity = String(signing?.bundleId ?? '').trim()
  return [
    t(`已等待一段时间，${pane}仍未生效。`, `The ${pane} grant still has not taken effect after waiting.`),
    t(
      '若你已在系统设置中开启：这是临时签名构建的已知问题，授权可能没有注册成功。',
      'If you already toggled it on in System Settings: this is a known issue with ad-hoc builds; the grant may not have registered.',
    ),
    t(
      `请在 系统设置 → 隐私与安全性 → ${pane} 列表中点「+」手动添加 MilkSU${identity ? `（对号入座找：${identity}）` : ''}，然后重启 MilkSU 再试。`,
      `Open System Settings → Privacy & Security → ${pane}, click “+” to add MilkSU manually${identity ? ` (look for ${identity})` : ''}, then restart MilkSU and try again.`,
    ),
  ].join(' ')
}

/**
 * 锁窗失败的权限守卫识别：manager.Start 的前置校验（「请先明确授予 MilkSU 辅助功能与
 * 屏幕录制权限，再启动可见会话」）与驱动 canary 的同类文案都命中。命中 ⇒ 面板改弹
 * 三态引导卡而不是一条干巴巴的 toast。
 */
export function isComputerUsePermissionGuardError(reason: unknown): boolean {
  const text = reason instanceof Error ? reason.message : String(reason ?? '')
  return /辅助功能|屏幕录制|accessibility|screen recording|screen capture/i.test(text)
}
