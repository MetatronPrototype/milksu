// R4 交付 3：Computer Use 权限向导三态判别（CU v2 §3.8，audit D6——用户已授权但 TCC
// 没注册上，驱动守卫分不清「没授权」与「授权没注册上」，跨 20 小时四轮被拦）。
import { describe, expect, it } from 'vitest'
import {
  PERMISSION_DRIFT_HINT_MS,
  isComputerUsePermissionGuardError,
  permissionDriftGuidance,
  permissionWizardState,
} from '@/lib/codingComputerUsePermissionWizard'

describe('permissionWizardState 三态判别', () => {
  const openedAt = 1_000_000
  const now = openedAt + PERMISSION_DRIFT_HINT_MS

  it('③ 布尔为真 ⇒ 已生效（granted），其余信号一律不打扰', () => {
    expect(permissionWizardState({ granted: true, settingsOpenedAt: null, now })).toBe('granted')
    expect(permissionWizardState({ granted: true, settingsOpenedAt: openedAt, now, userConfirmedNotEffective: true })).toBe('granted')
  })

  it('① 没授权且没打开过设置 ⇒ ungranted', () => {
    expect(permissionWizardState({ granted: false, settingsOpenedAt: null, now })).toBe('ungranted')
  })

  it('① 打开过设置但等待未到阈值 ⇒ 仍是 ungranted（给授权生效留时间）', () => {
    expect(permissionWizardState({
      granted: false, settingsOpenedAt: openedAt, now: openedAt + PERMISSION_DRIFT_HINT_MS - 1,
    })).toBe('ungranted')
  })

  it('② 打开设置后等待到阈值仍未生效 ⇒ drift（时间侧兜底）', () => {
    expect(permissionWizardState({
      granted: false, settingsOpenedAt: openedAt, now: openedAt + PERMISSION_DRIFT_HINT_MS,
    })).toBe('drift')
    expect(permissionWizardState({
      granted: false, settingsOpenedAt: openedAt, now: openedAt + PERMISSION_DRIFT_HINT_MS + 5_000,
    })).toBe('drift')
  })

  it('② 用户确认「我已开启但没生效」⇒ 立即 drift（问答式，§3.8-4：TCC 查询受限）', () => {
    expect(permissionWizardState({
      granted: false, settingsOpenedAt: null, now, userConfirmedNotEffective: true,
    })).toBe('drift')
  })

  it('driftHintMs 可覆盖（其它平台传 Infinity 关掉时间侧判别）', () => {
    expect(permissionWizardState({
      granted: false, settingsOpenedAt: openedAt, now: openedAt + 1e9, driftHintMs: Number.POSITIVE_INFINITY,
    })).toBe('ungranted')
    expect(permissionWizardState({
      granted: false, settingsOpenedAt: openedAt, now: openedAt + 1_000, driftHintMs: 500,
    })).toBe('drift')
  })
})

describe('permissionDriftGuidance 漂移指引文案', () => {
  it('屏幕录制：写明手动添加步骤、签名身份对号入座与重启', () => {
    const text = permissionDriftGuidance('screen-recording', {
      bundleId: 'com.milksu.app', stableIdentity: false,
    })
    expect(text).toContain('屏幕录制')
    expect(text).toContain('仍未生效')
    expect(text).toContain('临时签名')
    expect(text).toContain('手动添加 MilkSU')
    expect(text).toContain('com.milksu.app')
    expect(text).toContain('重启 MilkSU')
  })

  it('辅助功能：pane 名跟着权限走；没有签名身份时不硬编', () => {
    const text = permissionDriftGuidance('accessibility', null)
    expect(text).toContain('辅助功能')
    expect(text).not.toContain('com.milksu.app')
  })
})

describe('isComputerUsePermissionGuardError 权限守卫识别', () => {
  it('manager.Start 前置校验文案命中（锁窗失败的权限守卫路径）', () => {
    expect(isComputerUsePermissionGuardError(
      new Error('请先明确授予 MilkSU 辅助功能与屏幕录制权限，再启动可见会话'),
    )).toBe(true)
  })

  it('驱动 canary 的英文文案也命中（大小写不敏感）', () => {
    expect(isComputerUsePermissionGuardError('Accessibility permission required')).toBe(true)
    expect(isComputerUsePermissionGuardError('Screen Recording not granted')).toBe(true)
    expect(isComputerUsePermissionGuardError('screen capture access denied')).toBe(true)
  })

  it('其它启动失败（目标无效、服务不可用等）不误命中', () => {
    expect(isComputerUsePermissionGuardError('选择的窗口无效')).toBe(false)
    expect(isComputerUsePermissionGuardError('Computer Use service is unavailable')).toBe(false)
    expect(isComputerUsePermissionGuardError(new Error('新目标无效，旧锁保留'))).toBe(false)
    expect(isComputerUsePermissionGuardError(null)).toBe(false)
  })
})
