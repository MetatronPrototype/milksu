package main

import (
	"testing"
	"time"
)

// 冷却只该拦住"反向"那一半：真正的互刷必须双向交替，拦住反向循环就跑不起来；
// 而"同方向继续干活"本来就不是循环（那由 agentDeliverySourceBurst 按会话管着）。
func spamPair(guard *agentDeliveryLoopGuard, at time.Time) {
	for round := 0; round < 12; round++ {
		source, target := "conv-a", "conv-b"
		if round%2 == 1 {
			source, target = "conv-b", "conv-a"
		}
		guard.record(source, target, at.Add(time.Duration(round)*time.Second))
	}
}

// ① 冷却期内：把预算刷爆的那一方继续同方向投 ⇒ 允许（红：现状被拒）
func TestDeliveryLoopCooldownLetsTheOpeningDirectionContinue(t *testing.T) {
	guard := newLoopGuard()
	now := time.Date(2026, 9, 18, 12, 0, 0, 0, time.UTC)
	spamPair(guard, now)
	// 第 12 次（round=11，奇数）是 conv-b -> conv-a，也就是它把预算刷爆了。
	openedAt := now.Add(11 * time.Second)
	if guard.remaining("conv-a", "conv-b", openedAt.Add(2*time.Second)) <= 0 {
		t.Fatal("the cooldown must be open in the reverse direction")
	}
	if got := guard.remaining("conv-b", "conv-a", openedAt.Add(2*time.Second)); got != 0 {
		t.Fatalf("the direction that tripped the budget must not be blocked by its own cooldown, got %s", got)
	}
}

// ② 冷却期内：反方向投 ⇒ 仍被拒，并报剩余冷却
func TestDeliveryLoopCooldownStillStopsTheReverseDirection(t *testing.T) {
	guard := newLoopGuard()
	now := time.Date(2026, 9, 18, 12, 0, 0, 0, time.UTC)
	spamPair(guard, now)
	openedAt := now.Add(11 * time.Second)
	got := guard.remaining("conv-a", "conv-b", openedAt.Add(2*time.Second))
	if got <= 0 {
		t.Fatal("the reverse direction must still be stopped inside the cooldown")
	}
	if got < 50*time.Second {
		t.Fatalf("the refusal must carry a readable remaining cooldown, got %s", got)
	}
	// 而且剩余要递减
	if again := guard.remaining("conv-a", "conv-b", openedAt.Add(20*time.Second)); again <= 0 || again >= got {
		t.Fatalf("remaining must count down, got %s after %s", again, got)
	}
}

// ③ 冷却结束后：两个方向都恢复
func TestDeliveryLoopRecoversBothDirectionsAfterTheCooldown(t *testing.T) {
	guard := newLoopGuard()
	now := time.Date(2026, 9, 18, 12, 0, 0, 0, time.UTC)
	spamPair(guard, now)
	openedAt := now.Add(11 * time.Second)
	first := guard.remaining("conv-a", "conv-b", openedAt.Add(2*time.Second))
	after := openedAt.Add(first + 2*time.Second)
	if got := guard.remaining("conv-a", "conv-b", after); got != 0 {
		t.Fatalf("the reverse direction must recover after the cooldown, got %s", got)
	}
	if got := guard.remaining("conv-b", "conv-a", after); got != 0 {
		t.Fatalf("the opening direction must be open too, got %s", got)
	}
}
