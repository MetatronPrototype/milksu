'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  probeComputerUsePermissions,
  computerUsePermissionsSettingsURL,
  primeComputerUsePermission,
  requestComputerUsePermission,
  shouldRelaunchAfterScreenRecordingGrant,
} = require('./computer-use-permissions.cjs')

test('probeComputerUsePermissions reads Electron host TCC without inventing grants', () => {
  const calls = []
  const result = probeComputerUsePermissions({
    isTrustedAccessibilityClient(prompt) {
      calls.push(['ax', prompt])
      return true
    },
    getMediaAccessStatus(mediaType) {
      calls.push(['screen', mediaType])
      return 'granted'
    },
  }, { prompt: false })
  assert.deepEqual(result, {
    accessibility: true,
    screenRecording: true,
    screenStatus: 'granted',
  })
  assert.deepEqual(calls, [['ax', false], ['screen', 'screen']])
})

test('probeComputerUsePermissions treats non-granted screen status as false', () => {
  for (const screenStatus of ['not-determined', 'denied', 'restricted', 'unknown', '']) {
    const result = probeComputerUsePermissions({
      isTrustedAccessibilityClient: () => false,
      getMediaAccessStatus: () => screenStatus,
    })
    assert.equal(result.accessibility, false)
    assert.equal(result.screenRecording, false)
    assert.equal(result.screenStatus, screenStatus || 'unknown')
  }
})

test('probeComputerUsePermissions fails closed when Electron APIs throw', () => {
  const result = probeComputerUsePermissions({
    isTrustedAccessibilityClient() { throw new Error('no ax') },
    getMediaAccessStatus() { throw new Error('no screen') },
  })
  assert.deepEqual(result, {
    accessibility: false,
    screenRecording: false,
    screenStatus: 'unknown',
  })
})

test('computerUsePermissionsSettingsURL opens the separately requested privacy pane', () => {
  assert.equal(
    computerUsePermissionsSettingsURL('screen-recording'),
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  )
  assert.equal(
    computerUsePermissionsSettingsURL('accessibility'),
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  )
  assert.throws(() => computerUsePermissionsSettingsURL('camera'), /unsupported Computer Use permission/)
})

test('primeComputerUsePermission registers the signed host before opening Settings', async () => {
  const accessibilityPrompts = []
  const accessibility = await primeComputerUsePermission({
    isTrustedAccessibilityClient(prompt) {
      accessibilityPrompts.push(prompt)
      return prompt
    },
    getMediaAccessStatus: () => 'denied',
  }, {}, 'accessibility')
  assert.deepEqual(accessibilityPrompts, [true, false])
  assert.equal(accessibility.accessibility, false)

  let screenRequests = 0
  const screen = await primeComputerUsePermission({
    isTrustedAccessibilityClient: () => false,
    getMediaAccessStatus: () => 'not-determined',
  }, async () => { screenRequests += 1 }, 'screen-recording')
  assert.equal(screenRequests, 1)
  assert.equal(screen.screenRecording, false)

  await assert.rejects(
    primeComputerUsePermission({}, {}, 'camera'),
    /unsupported Computer Use permission/,
  )
})

test('primeComputerUsePermission does not recapture after Screen Recording is granted', async () => {
  let sourceRequests = 0
  const result = await primeComputerUsePermission({
    isTrustedAccessibilityClient: () => true,
    getMediaAccessStatus: () => 'granted',
  }, async () => { sourceRequests += 1 }, 'screen-recording')
  assert.equal(sourceRequests, 0)
  assert.equal(result.screenRecording, true)
})

test('requestComputerUsePermission prompts exactly the requested kind', async () => {
  // 辅助功能：只弹 AX 原生框，屏幕录制保持只查。
  const axCalls = []
  const ax = await requestComputerUsePermission({
    isTrustedAccessibilityClient(prompt) {
      axCalls.push(prompt)
      return false
    },
    getMediaAccessStatus(mediaType) {
      axCalls.push(['screen', mediaType])
      return 'not-determined'
    },
  }, undefined, 'accessibility')
  assert.deepEqual(axCalls, [true, false, ['screen', 'screen']])
  assert.deepEqual(ax, { accessibility: false, screenRecording: false, screenStatus: 'not-determined' })

  // 屏幕录制：走 CGRequestScreenCaptureAccess 原生请求，AX 不弹。
  const screenCalls = []
  let screenRequests = 0
  const screen = await requestComputerUsePermission({
    isTrustedAccessibilityClient(prompt) {
      screenCalls.push(prompt)
      return false
    },
    getMediaAccessStatus: () => 'granted',
  }, async () => { screenRequests += 1; return true }, 'screen-recording')
  assert.deepEqual(screenCalls, [false])
  assert.equal(screenRequests, 1)
  assert.equal(screen.screenRecording, true)

  // 原生请求抛错（桥缺失/受限）：不发明授权，静默复查真值。
  const broken = await requestComputerUsePermission({
    isTrustedAccessibilityClient: () => false,
    getMediaAccessStatus: () => 'denied',
  }, async () => { throw new Error('bridge unavailable') }, 'screen-recording')
  assert.deepEqual(broken, { accessibility: false, screenRecording: false, screenStatus: 'denied' })

  await assert.rejects(
    requestComputerUsePermission({}, undefined, 'camera'),
    /unsupported Computer Use permission/,
  )
})

test('screen grant relaunch is armed only for a fresh transition to granted', () => {
  const openedAt = Date.now()
  assert.equal(shouldRelaunchAfterScreenRecordingGrant({
    openedAt,
    previousStatus: 'denied',
  }, 'granted', openedAt + 1000), true)
  assert.equal(shouldRelaunchAfterScreenRecordingGrant({
    openedAt,
    previousStatus: 'granted',
  }, 'granted', openedAt + 1000), false)
  assert.equal(shouldRelaunchAfterScreenRecordingGrant({
    openedAt,
    previousStatus: 'denied',
  }, 'denied', openedAt + 1000), false)
  assert.equal(shouldRelaunchAfterScreenRecordingGrant({
    openedAt,
    previousStatus: 'denied',
  }, 'granted', openedAt + 11 * 60 * 1000), false)
})
